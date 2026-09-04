import { createHash } from 'node:crypto'
import type { Database } from '../../db.js'
import { inTransaction } from '../../db.js'
import type { AuthenticatedIdentity } from '../identity/identity-module.js'
import {
  inspectAuthenticatedIdentity,
  makeAuthorizedSpace,
} from '../private-capabilities.js'
import {
  isDatabaseError,
  type AccessRevision,
  type BrowserSessionDirective,
  type FieldIssue,
  type IdentityId,
  type MemberId,
  type OpaqueCursor,
  type PageRequest,
  type RequestId,
  type Result,
  type Revision,
  type SpaceId,
  type SpaceKey,
} from '../shared.js'

declare const authorizedSpaceBrand: unique symbol

export type SpaceUse =
  | 'board-read'
  | 'board-change'
  | 'board-follow'
  | 'space-audit-read'
  | 'space-export'

export interface AuthorizedSpace<P extends SpaceUse = SpaceUse> {
  readonly [authorizedSpaceBrand]: P
}

export type SpaceLocator =
  | { kind: 'id'; spaceId: SpaceId }
  | { kind: 'key'; spaceKey: SpaceKey }

export interface SpaceSummary {
  id: SpaceId
  key: SpaceKey
  displayName: string
  timeZone: string
  lifecycle: 'active' | 'archived' | 'deletion_scheduled'
  revision: Revision
  accessRevision: AccessRevision
  memberRole: 'member' | 'space-administrator'
}

export type SpaceQuery =
  | { kind: 'switcher'; include: 'active' | 'archived' | 'all'; page?: PageRequest }
  | { kind: 'space'; space: SpaceLocator }

export type SpaceView =
  | { kind: 'switcher'; spaces: SpaceSummary[]; next?: OpaqueCursor }
  | { kind: 'space'; space: SpaceSummary }

export interface CreateSpaceInput {
  displayName: string
  key: string
  timeZone: string
}

export interface SpaceChangeRequest {
  requestId: RequestId
  command: { kind: 'create-space'; input: CreateSpaceInput }
}

export interface SpaceChangeReceipt {
  result: { kind: 'space-created'; space: SpaceSummary }
  session: Extract<BrowserSessionDirective, { kind: 'unchanged' }>
  accessRevision: AccessRevision
}

export type SpaceFault =
  | { kind: 'not-authenticated' }
  | { kind: 'invalid'; issues: FieldIssue[] }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'read-only'; reason: 'space-archived' | 'deletion-scheduled' }
  | { kind: 'conflict'; reason: 'request-id-reused' | 'space-key-unavailable' }
  | { kind: 'temporarily-unavailable' }

export interface AuthorizeSpaceRequest<P extends SpaceUse> {
  space: SpaceLocator
  use: P
}

export interface SpaceModule {
  read(identity: AuthenticatedIdentity, query: SpaceQuery): Promise<Result<SpaceView, SpaceFault>>
  change(identity: AuthenticatedIdentity, request: SpaceChangeRequest): Promise<Result<SpaceChangeReceipt, SpaceFault>>
  authorize<P extends SpaceUse>(
    identity: AuthenticatedIdentity,
    request: AuthorizeSpaceRequest<P>,
  ): Promise<Result<AuthorizedSpace<P>, SpaceFault>>
}

interface SpaceRow {
  id: string
  space_key: string
  display_name: string
  time_zone: string
  lifecycle: 'active' | 'archived' | 'deletion_scheduled'
  revision: number
  access_revision: string | number
  role: 'member' | 'space-administrator'
  member_id: string
  sort_name?: string
}

export class SpaceModuleImplementation implements SpaceModule {
  constructor(private readonly db: Database) {}

  async read(identity: AuthenticatedIdentity, query: SpaceQuery): Promise<Result<SpaceView, SpaceFault>> {
    const claims = inspectAuthenticatedIdentity(identity)
    if (!claims) return { ok: false, fault: { kind: 'not-authenticated' } }

    try {
      if (query.kind === 'switcher') {
        if (query.page?.size !== undefined && (!Number.isInteger(query.page.size) || query.page.size < 1)) {
          return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'page.size', message: 'Use a positive whole number.' }] } }
        }
        const size = Math.min(query.page?.size ?? 50, 200)
        const cursor = decodeSwitcherCursor(query.page?.after, query.include)
        if (!cursor.ok) return cursor
        const lifecycles = query.include === 'active'
          ? ['active']
          : query.include === 'archived'
            ? ['archived', 'deletion_scheduled']
            : ['active', 'archived', 'deletion_scheduled']
        const result = await this.db.query<SpaceRow>(
          `select space.id, space.space_key, space.display_name, space.time_zone,
                  space.lifecycle, space.revision, space.access_revision,
                  member.id as member_id, member.role, lower(space.display_name) as sort_name
           from team.members member
           join team.spaces space on space.id = member.space_id
           where member.identity_id = $1 and member.ended_at is null
             and space.lifecycle = any($2::text[])
             and ($3::text is null or (lower(space.display_name), space.space_key, space.id::text) > ($3,$4,$5))
           order by lower(space.display_name), space.space_key, space.id::text
           limit $6`,
          [claims.identityId, lifecycles, cursor.value?.name ?? null, cursor.value?.key ?? null, cursor.value?.id ?? null, size + 1],
        )
        const pageRows = result.rows.slice(0, size)
        const last = pageRows.at(-1)
        const next = result.rows.length > size && last
          ? encodeSwitcherCursor(query.include, last)
          : undefined
        return { ok: true, value: { kind: 'switcher', spaces: pageRows.map(spaceSummary), next } }
      }

      const row = await this.findSpace(claims.identityId, query.space)
      if (!row) return { ok: false, fault: { kind: 'not-found' } }
      return { ok: true, value: { kind: 'space', space: spaceSummary(row) } }
    } catch (error) {
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }

  async change(
    identity: AuthenticatedIdentity,
    request: SpaceChangeRequest,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const claims = inspectAuthenticatedIdentity(identity)
    if (!claims) return { ok: false, fault: { kind: 'not-authenticated' } }
    if (!request.requestId || request.requestId.length > 100) {
      return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'requestId', message: 'Use 1 to 100 characters.' }] } }
    }

    const normalized = normalizeCreateSpace(request.command.input)
    const requestHash = hashCreateSpace(normalized)

    try {
      return await inTransaction(this.db, async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${claims.identityId}:${request.requestId}`])
        const previous = await client.query<{ request_hash: string; response: SpaceChangeReceipt }>(
          `select request_hash, response from team.space_request_receipts
           where identity_id = $1 and request_id = $2`,
          [claims.identityId, request.requestId],
        )
        if (previous.rows[0]) {
          if (previous.rows[0].request_hash !== requestHash) {
            return { ok: false as const, fault: { kind: 'conflict' as const, reason: 'request-id-reused' as const } }
          }
          return { ok: true as const, value: previous.rows[0].response }
        }

        const issues = validateCreateSpace(normalized)
        if (issues.length > 0) return { ok: false as const, fault: { kind: 'invalid' as const, issues } }
        if (!claims.installationAdministrator) return { ok: false as const, fault: { kind: 'forbidden' as const } }

        const now = new Date()
        await client.query(
          `insert into team.space_key_reservations (space_key, reserved_at, reserved_by_identity_id)
           values ($1,$2,$3)`,
          [normalized.key, now, claims.identityId],
        )
        const createdSpace = await client.query<{
          id: string
          space_key: string
          display_name: string
          time_zone: string
          lifecycle: SpaceRow['lifecycle']
          revision: number
          access_revision: string | number
        }>(
          `insert into team.spaces
            (space_key, display_name, time_zone, created_by_identity_id, created_at)
           values ($1,$2,$3,$4,$5)
           returning id, space_key, display_name, time_zone, lifecycle, revision, access_revision`,
          [normalized.key, normalized.displayName, normalized.timeZone, claims.identityId, now],
        )
        const space = createdSpace.rows[0]
        await client.query(
          `insert into team.members (space_id, identity_id, role, joined_at)
           values ($1,$2,'space-administrator',$3) returning id`,
          [space.id, claims.identityId, now],
        )
        const board = await client.query<{ id: string }>(
          'insert into team.boards (space_id, created_at) values ($1,$2) returning id',
          [space.id, now],
        )
        await client.query(
          `insert into team.board_columns
            (board_id, space_id, name, flow_role, is_intake, is_completion, wip_limit, position)
           values
            ($1,$2,'Backlog','queue',true,false,null,0),
            ($1,$2,'In Progress','active',false,false,3,1000),
            ($1,$2,'Done','complete',false,true,null,2000)`,
          [board.rows[0].id, space.id],
        )

        const summary: SpaceSummary = {
          id: space.id as SpaceId,
          key: space.space_key as SpaceKey,
          displayName: space.display_name,
          timeZone: space.time_zone,
          lifecycle: space.lifecycle,
          revision: space.revision as Revision,
          accessRevision: Number(space.access_revision) as AccessRevision,
          memberRole: 'space-administrator',
        }
        const receipt: SpaceChangeReceipt = {
          result: { kind: 'space-created', space: summary },
          session: { kind: 'unchanged' },
          accessRevision: summary.accessRevision,
        }
        await client.query(
          `insert into team.space_request_receipts
            (identity_id, request_id, request_hash, response, created_at)
           values ($1,$2,$3,$4,$5)`,
          [claims.identityId, request.requestId, requestHash, receipt, now],
        )
        return { ok: true as const, value: receipt }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, fault: { kind: 'conflict', reason: 'space-key-unavailable' } }
      }
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }

  async authorize<P extends SpaceUse>(
    identity: AuthenticatedIdentity,
    request: AuthorizeSpaceRequest<P>,
  ): Promise<Result<AuthorizedSpace<P>, SpaceFault>> {
    const identityValue = inspectAuthenticatedIdentity(identity)
    if (!identityValue) return { ok: false, fault: { kind: 'not-authenticated' } }
    try {
      const row = await this.findSpace(identityValue.identityId, request.space)
      if (!row) return { ok: false, fault: { kind: 'not-found' } }
      if (request.use === 'board-change' && row.lifecycle !== 'active') {
        return {
          ok: false,
          fault: {
            kind: 'read-only',
            reason: row.lifecycle === 'archived' ? 'space-archived' : 'deletion-scheduled',
          },
        }
      }
      if (request.use === 'board-follow' && row.lifecycle !== 'active') {
        return { ok: false, fault: { kind: 'forbidden' } }
      }

      return {
        ok: true,
        value: makeAuthorizedSpace<P>({
          sessionId: identityValue.sessionId,
          identityId: identityValue.identityId,
          memberId: row.member_id as MemberId,
          spaceId: row.id as SpaceId,
          use: request.use,
          accessRevision: Number(row.access_revision) as AccessRevision,
        }),
      }
    } catch (error) {
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }

  private async findSpace(identityId: IdentityId, locator: SpaceLocator): Promise<SpaceRow | undefined> {
    const value = locator.kind === 'id' ? locator.spaceId : locator.spaceKey.toUpperCase()
    const column = locator.kind === 'id' ? 'space.id' : 'space.space_key'
    const result = await this.db.query<SpaceRow>(
      `select space.id, space.space_key, space.display_name, space.time_zone,
              space.lifecycle, space.revision, space.access_revision,
              member.id as member_id, member.role
       from team.spaces space
       join team.members member on member.space_id = space.id
       where ${column} = $1 and member.identity_id = $2 and member.ended_at is null`,
      [value, identityId],
    )
    return result.rows[0]
  }
}

function normalizeCreateSpace(input: CreateSpaceInput): CreateSpaceInput {
  return {
    displayName: typeof input.displayName === 'string' ? input.displayName.trim() : '',
    key: typeof input.key === 'string' ? input.key.trim().toUpperCase() : '',
    timeZone: typeof input.timeZone === 'string' ? input.timeZone.trim() : '',
  }
}

function validateCreateSpace(input: CreateSpaceInput): FieldIssue[] {
  const issues: FieldIssue[] = []
  if (input.displayName.length < 1 || input.displayName.length > 60) {
    issues.push({ field: 'displayName', message: 'Use 1 to 60 characters.' })
  }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(input.key)) {
    issues.push({ field: 'key', message: 'Use 2 to 10 letters or numbers, starting with a letter.' })
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format()
  } catch {
    issues.push({ field: 'timeZone', message: 'Use an IANA time zone such as Europe/Oslo.' })
  }
  return issues
}

function hashCreateSpace(input: CreateSpaceInput): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'create-space', input }))
    .digest('hex')
}

function spaceSummary(row: SpaceRow): SpaceSummary {
  return {
    id: row.id as SpaceId,
    key: row.space_key as SpaceKey,
    displayName: row.display_name,
    timeZone: row.time_zone,
    lifecycle: row.lifecycle,
    revision: row.revision as Revision,
    accessRevision: Number(row.access_revision) as AccessRevision,
    memberRole: row.role,
  }
}

function isUniqueViolation(error: unknown): error is { code: '23505' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

interface SwitcherCursor {
  version: 1
  include: 'active' | 'archived' | 'all'
  name: string
  key: string
  id: string
}

function decodeSwitcherCursor(
  value: OpaqueCursor | undefined,
  include: SwitcherCursor['include'],
): Result<SwitcherCursor | undefined, SpaceFault> {
  if (!value) return { ok: true, value: undefined }
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SwitcherCursor>
    if (cursor.version !== 1 || cursor.include !== include || typeof cursor.name !== 'string'
      || typeof cursor.key !== 'string' || typeof cursor.id !== 'string') throw new Error('invalid cursor')
    return { ok: true, value: cursor as SwitcherCursor }
  } catch {
    return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'page.after', message: 'Use a cursor from the previous page.' }] } }
  }
}

function encodeSwitcherCursor(include: SwitcherCursor['include'], row: SpaceRow): OpaqueCursor {
  return Buffer.from(JSON.stringify({
    version: 1,
    include,
    name: row.sort_name ?? row.display_name.toLocaleLowerCase(),
    key: row.space_key,
    id: row.id,
  } satisfies SwitcherCursor)).toString('base64url') as OpaqueCursor
}
