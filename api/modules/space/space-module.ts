import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { Database, DbClient } from '../../db.js'
import { inTransaction } from '../../db.js'
import type { AuthenticatedIdentity } from '../identity/identity-module.js'
import { PrivateSessionCoordinator } from '../identity/private-session-coordinator.js'
import { inspectAuthenticatedIdentity, makeAuthorizedSpace } from '../private-capabilities.js'
import {
  isDatabaseError,
  type AccessRevision,
  type AuditId,
  type BrowserSessionDirective,
  type FieldIssue,
  type IdentityId,
  type Instant,
  type InvitationId,
  type MemberId,
  type OpaqueCursor,
  type OpaqueSecret,
  type PageRequest,
  type RequestId,
  type Result,
  type Revision,
  type SpaceId,
  type SpaceKey,
} from '../shared.js'

declare const authorizedSpaceBrand: unique symbol

const INVITATION_LIFETIME_MILLISECONDS = 7 * 24 * 60 * 60 * 1000
const DELETION_GRACE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000

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

export type MemberRole = 'member' | 'space-administrator'

export interface SpaceSummary {
  id: SpaceId
  key: SpaceKey
  displayName: string
  timeZone: string
  lifecycle: 'active' | 'archived' | 'deletion_scheduled'
  revision: Revision
  accessRevision: AccessRevision
  memberRole: MemberRole
  deletionScheduledFor?: Instant
}

export interface InvitationView {
  id: InvitationId
  issuedAt: Instant
  expiresAt: Instant
  state: 'pending' | 'revoked' | 'accepted' | 'expired'
}

export type SpaceAuditAction =
  | 'space-created'
  | 'space-revised'
  | 'invitation-issued'
  | 'invitation-revoked'
  | 'invitation-accepted'
  | 'member-role-changed'
  | 'member-removed'
  | 'member-left'
  | 'space-archived'
  | 'space-restored'
  | 'space-deletion-scheduled'
  | 'space-deletion-cancelled'

export interface SpaceAuditView {
  id: AuditId
  action: SpaceAuditAction
  actorDisplayName: string
  subjectMemberId?: MemberId
  invitationId?: InvitationId
  occurredAt: Instant
}

export interface MemberView {
  id: MemberId
  displayName: string
  role: MemberRole
  revision: Revision
  joinedAt: Instant
}

export interface VersionedMember {
  memberId: MemberId
  expectedRevision: Revision
}

export interface VersionedSpace {
  spaceId: SpaceId
  expectedRevision: Revision
}

export interface SpaceChanges {
  displayName?: string
  timeZone?: string
}

export type SpaceQuery =
  | { kind: 'switcher'; include: 'active' | 'archived' | 'all'; page?: PageRequest }
  | { kind: 'space'; space: SpaceLocator }
  | { kind: 'members'; space: SpaceLocator; page?: PageRequest }
  | { kind: 'invitations'; space: SpaceLocator; page?: PageRequest }
  | { kind: 'audit'; space: SpaceLocator; page?: PageRequest }

export type SpaceView =
  | { kind: 'switcher'; spaces: SpaceSummary[]; next?: OpaqueCursor }
  | { kind: 'space'; space: SpaceSummary }
  | { kind: 'members'; members: MemberView[]; next?: OpaqueCursor }
  | { kind: 'invitations'; invitations: InvitationView[]; next?: OpaqueCursor }
  | { kind: 'audit'; entries: SpaceAuditView[]; next?: OpaqueCursor }

export interface CreateSpaceInput {
  displayName: string
  key: string
  timeZone: string
}

export type SpaceCommand =
  | { kind: 'create-space'; input: CreateSpaceInput }
  | { kind: 'issue-invitation'; space: SpaceLocator }
  | { kind: 'revoke-invitation'; space: SpaceLocator; invitationId: InvitationId }
  | { kind: 'accept-invitation'; invitationSecret: OpaqueSecret }
  | { kind: 'set-member-role'; space: SpaceLocator; member: VersionedMember; role: MemberRole }
  | { kind: 'remove-member'; space: SpaceLocator; member: VersionedMember }
  | { kind: 'leave-space'; space: SpaceLocator }
  | { kind: 'archive-space'; space: VersionedSpace }
  | { kind: 'restore-space'; space: VersionedSpace }
  | { kind: 'revise-space'; space: VersionedSpace; changes: SpaceChanges }
  | { kind: 'schedule-space-deletion'; space: VersionedSpace }
  | { kind: 'cancel-space-deletion'; space: VersionedSpace }

export interface SpaceChangeRequest {
  requestId: RequestId
  command: SpaceCommand
}

export type SpaceCommandResult =
  | { kind: 'space-created'; space: SpaceSummary }
  | { kind: 'invitation-issued'; invitation: InvitationView; invitationSecret: OpaqueSecret }
  | { kind: 'invitation-revoked'; invitation: InvitationView }
  | { kind: 'invitation-accepted'; space: SpaceSummary }
  | { kind: 'member-role-changed'; member: MemberView }
  | { kind: 'member-removed'; memberId: MemberId }
  | { kind: 'member-left'; memberId: MemberId }
  | { kind: 'space-archived'; space: SpaceSummary }
  | { kind: 'space-restored'; space: SpaceSummary }
  | { kind: 'space-revised'; space: SpaceSummary }
  | { kind: 'space-deletion-scheduled'; space: SpaceSummary }
  | { kind: 'space-deletion-cancelled'; space: SpaceSummary }

export interface SpaceChangeReceipt {
  result: SpaceCommandResult
  session: BrowserSessionDirective
  accessRevision: AccessRevision
}

export type SpaceFault =
  | { kind: 'not-authenticated' }
  | { kind: 'invalid'; issues: FieldIssue[] }
  | { kind: 'invalid-invitation' }
  | { kind: 'last-administrator' }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'read-only'; reason: 'space-archived' | 'deletion-scheduled' }
  | { kind: 'conflict'; reason: 'request-id-reused' | 'space-key-unavailable' | 'stale-member' | 'stale-space' | 'invalid-lifecycle' }
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

export interface SpaceModuleConfig {
  invitationHmacSecret: string
  sessionHmacSecret: string
  accessInvalidation?: SpaceAccessInvalidationPort
  now?: () => Date
}

export interface SpaceAccessInvalidation {
  spaceId: SpaceId
  accessRevision: AccessRevision
  reason: 'membership-changed' | 'space-lifecycle-changed'
}

export interface SpaceAccessInvalidationPort {
  publish(event: SpaceAccessInvalidation): Promise<void> | void
}

interface SpaceRow {
  id: string
  space_key: string
  display_name: string
  time_zone: string
  lifecycle: SpaceSummary['lifecycle']
  revision: number
  access_revision: string | number
  role: MemberRole
  member_id: string
  sort_name?: string
  deletion_scheduled_for?: Date | null
}

interface InvitationRow {
  id: string
  space_id: string
  issued_at: Date
  expires_at: Date
  revoked_at: Date | null
  accepted_at: Date | null
}

type IdentityEvidence = NonNullable<ReturnType<typeof inspectAuthenticatedIdentity>>

export class SpaceModuleImplementation implements SpaceModule {
  private readonly now: () => Date
  private readonly sessions: PrivateSessionCoordinator

  constructor(
    private readonly db: Database,
    private readonly config: SpaceModuleConfig,
  ) {
    this.now = config.now ?? (() => new Date())
    this.sessions = new PrivateSessionCoordinator(config.sessionHmacSecret)
  }

  async read(identity: AuthenticatedIdentity, query: SpaceQuery): Promise<Result<SpaceView, SpaceFault>> {
    const claims = inspectAuthenticatedIdentity(identity)
    if (!claims) return { ok: false, fault: { kind: 'not-authenticated' } }

    try {
      if (query.kind === 'switcher') return await this.readSwitcher(claims.identityId, query)
      if (query.kind === 'members') return await this.readMembers(claims.identityId, query)
      if (query.kind === 'invitations') return await this.readInvitations(claims.identityId, query)
      if (query.kind === 'audit') return await this.readAudit(claims.identityId, query)
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

    const command = normalizeCommand(request.command)
    const requestHash = hashCommand(command)
    try {
      const completed = await inTransaction(this.db, async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${claims.identityId}:${request.requestId}`])
        const previous = await client.query<{ request_hash: string; response: SpaceChangeReceipt }>(
          `select request_hash, response from team.space_request_receipts
           where identity_id = $1 and request_id = $2`,
          [claims.identityId, request.requestId],
        )
        if (previous.rows[0]) {
          if (previous.rows[0].request_hash !== requestHash) {
            return {
              outcome: { ok: false as const, fault: { kind: 'conflict' as const, reason: 'request-id-reused' as const } },
              committedChange: false,
            }
          }
          return {
            outcome: { ok: true as const, value: this.restoreStoredReceipt(previous.rows[0].response) },
            committedChange: false,
          }
        }

        let result: Result<SpaceChangeReceipt, SpaceFault>
        switch (command.kind) {
          case 'create-space':
            result = await this.createSpace(client, claims, command.input)
            break
          case 'issue-invitation':
            result = await this.issueInvitation(client, claims, command.space)
            break
          case 'revoke-invitation':
            result = await this.revokeInvitation(client, claims, command.space, command.invitationId)
            break
          case 'accept-invitation':
            result = await this.acceptInvitation(client, claims, command.invitationSecret)
            break
          case 'set-member-role':
            result = await this.setMemberRole(client, claims, command.space, command.member, command.role)
            break
          case 'leave-space':
            result = await this.leaveSpace(client, claims, command.space)
            break
          case 'remove-member':
            result = await this.removeMember(client, claims, command.space, command.member)
            break
          case 'archive-space':
            result = await this.setSpaceLifecycle(client, claims, command.space, 'archive')
            break
          case 'restore-space':
            result = await this.setSpaceLifecycle(client, claims, command.space, 'restore')
            break
          case 'revise-space':
            result = await this.reviseSpace(client, claims, command.space, command.changes)
            break
          case 'schedule-space-deletion':
            result = await this.changeDeletionSchedule(client, claims, command.space, 'schedule')
            break
          case 'cancel-space-deletion':
            result = await this.changeDeletionSchedule(client, claims, command.space, 'cancel')
            break
        }
        if (!result.ok) return { outcome: result, committedChange: false }

        await client.query(
          `insert into team.space_request_receipts
            (identity_id, request_id, request_hash, response, created_at)
           values ($1,$2,$3,$4,$5)`,
          [claims.identityId, request.requestId, requestHash, storedReceipt(result.value), this.now()],
        )
        return { outcome: result, committedChange: true }
      })
      if (completed.committedChange && completed.outcome.ok) {
        await this.publishAccessInvalidation(command, completed.outcome.value)
      }
      return completed.outcome
    } catch (error) {
      if (command.kind === 'create-space' && isUniqueViolation(error)) {
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
        return { ok: false, fault: lifecycleFault(row.lifecycle) }
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

  private async readSwitcher(
    identityId: IdentityId,
    query: Extract<SpaceQuery, { kind: 'switcher' }>,
  ): Promise<Result<SpaceView, SpaceFault>> {
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
              member.id as member_id, member.role, lower(space.display_name) as sort_name,
              space.deletion_scheduled_for
       from team.members member
       join team.spaces space on space.id = member.space_id
       where member.identity_id = $1 and member.ended_at is null
         and space.lifecycle = any($2::text[])
         and ($3::text is null or (lower(space.display_name), space.space_key, space.id::text) > ($3,$4,$5))
       order by lower(space.display_name), space.space_key, space.id::text
       limit $6`,
      [identityId, lifecycles, cursor.value?.name ?? null, cursor.value?.key ?? null, cursor.value?.id ?? null, size + 1],
    )
    const pageRows = result.rows.slice(0, size)
    const last = pageRows.at(-1)
    const next = result.rows.length > size && last ? encodeSwitcherCursor(query.include, last) : undefined
    return { ok: true, value: { kind: 'switcher', spaces: pageRows.map(spaceSummary), next } }
  }

  private async createSpace(
    client: DbClient,
    claims: IdentityEvidence,
    input: CreateSpaceInput,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const issues = validateCreateSpace(input)
    if (issues.length > 0) return { ok: false, fault: { kind: 'invalid', issues } }
    if (!claims.installationAdministrator) return { ok: false, fault: { kind: 'forbidden' } }

    const now = this.now()
    await client.query(
      `insert into team.space_key_reservations (space_key, reserved_at, reserved_by_identity_id)
       values ($1,$2,$3)`,
      [input.key, now, claims.identityId],
    )
    const created = await client.query<Omit<SpaceRow, 'role' | 'member_id'>>(
      `insert into team.spaces
        (space_key, display_name, time_zone, created_by_identity_id, created_at)
       values ($1,$2,$3,$4,$5)
       returning id, space_key, display_name, time_zone, lifecycle, revision, access_revision`,
      [input.key, input.displayName, input.timeZone, claims.identityId, now],
    )
    const space = created.rows[0]
    const member = await client.query<{ id: string }>(
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
    await recordAudit(client, space.id as SpaceId, claims.identityId, 'space-created', now, {
      subjectMemberId: member.rows[0].id as MemberId,
    })

    const summary = spaceSummary({ ...space, role: 'space-administrator', member_id: member.rows[0].id })
    return {
      ok: true,
      value: {
        result: { kind: 'space-created', space: summary },
        session: { kind: 'unchanged' },
        accessRevision: summary.accessRevision,
      },
    }
  }

  private async readMembers(
    identityId: IdentityId,
    query: Extract<SpaceQuery, { kind: 'members' }>,
  ): Promise<Result<SpaceView, SpaceFault>> {
    const access = await this.findSpace(identityId, query.space)
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    const page = pageSize(query.page)
    if (!page.ok) return page
    const cursor = decodeMemberCursor(query.page?.after, access.id)
    if (!cursor.ok) return cursor
    const result = await this.db.query<{
      id: string
      display_name: string
      sort_name: string
      role: MemberRole
      revision: number
      joined_at: Date
    }>(
      `select member.id, identity.display_name, lower(identity.display_name) as sort_name,
              member.role, member.revision, member.joined_at
       from team.members member
       join team.identities identity on identity.id = member.identity_id
       where member.space_id = $1 and member.ended_at is null
         and ($2::text is null or (lower(identity.display_name), member.id::text) > ($2,$3))
       order by lower(identity.display_name), member.id::text
       limit $4`,
      [access.id, cursor.value?.name ?? null, cursor.value?.id ?? null, page.value + 1],
    )
    const rows = result.rows.slice(0, page.value)
    const last = rows.at(-1)
    return {
      ok: true,
      value: {
        kind: 'members',
        members: rows.map((row) => ({
          id: row.id as MemberId,
          displayName: row.display_name,
          role: row.role,
          revision: row.revision as Revision,
          joinedAt: row.joined_at.toISOString() as Instant,
        })),
        next: result.rows.length > page.value && last
          ? encodeMemberCursor(access.id, last.sort_name, last.id)
          : undefined,
      },
    }
  }

  private async readInvitations(
    identityId: IdentityId,
    query: Extract<SpaceQuery, { kind: 'invitations' }>,
  ): Promise<Result<SpaceView, SpaceFault>> {
    const access = await this.findSpace(identityId, query.space)
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }
    const page = pageSize(query.page)
    if (!page.ok) return page
    const cursor = decodeTimelineCursor(query.page?.after, 'invitations', access.id)
    if (!cursor.ok) return cursor
    const result = await this.db.query<InvitationRow>(
      `select id, space_id, issued_at, expires_at, revoked_at, accepted_at
       from team.space_invitations
       where space_id = $1
         and ($2::timestamptz is null or (issued_at, id::text) < ($2,$3))
       order by issued_at desc, id::text desc
       limit $4`,
      [access.id, cursor.value?.time ?? null, cursor.value?.tieBreaker ?? null, page.value + 1],
    )
    const rows = result.rows.slice(0, page.value)
    const last = rows.at(-1)
    return {
      ok: true,
      value: {
        kind: 'invitations',
        invitations: rows.map((row) => invitationView(row, this.now())),
        next: result.rows.length > page.value && last
          ? encodeTimelineCursor('invitations', access.id, last.issued_at, last.id)
          : undefined,
      },
    }
  }

  private async readAudit(
    identityId: IdentityId,
    query: Extract<SpaceQuery, { kind: 'audit' }>,
  ): Promise<Result<SpaceView, SpaceFault>> {
    const access = await this.findSpace(identityId, query.space)
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }
    const page = pageSize(query.page)
    if (!page.ok) return page
    const cursor = decodeTimelineCursor(query.page?.after, 'audit', access.id)
    if (!cursor.ok) return cursor
    const result = await this.db.query<{
      id: string
      ordering_key: string | number
      action: SpaceAuditAction
      actor_display_name: string
      subject_member_id: string | null
      invitation_id: string | null
      occurred_at: Date
    }>(
      `select audit.id, audit.ordering_key, audit.action, identity.display_name as actor_display_name,
              audit.subject_member_id, audit.invitation_id, audit.occurred_at
       from team.space_audit audit
       join team.identities identity on identity.id = audit.actor_identity_id
       where audit.space_id = $1
         and ($2::timestamptz is null or (audit.occurred_at, audit.ordering_key) < ($2,$3::bigint))
       order by audit.occurred_at desc, audit.ordering_key desc
       limit $4`,
      [access.id, cursor.value?.time ?? null, cursor.value?.tieBreaker ?? null, page.value + 1],
    )
    const rows = result.rows.slice(0, page.value)
    const last = rows.at(-1)
    return {
      ok: true,
      value: {
        kind: 'audit',
        entries: rows.map((row) => ({
          id: row.id as AuditId,
          action: row.action,
          actorDisplayName: row.actor_display_name,
          subjectMemberId: row.subject_member_id ? row.subject_member_id as MemberId : undefined,
          invitationId: row.invitation_id ? row.invitation_id as InvitationId : undefined,
          occurredAt: row.occurred_at.toISOString() as Instant,
        })),
        next: result.rows.length > page.value && last
          ? encodeTimelineCursor('audit', access.id, last.occurred_at, String(last.ordering_key))
          : undefined,
      },
    }
  }

  private async issueInvitation(
    client: DbClient,
    claims: IdentityEvidence,
    locator: SpaceLocator,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const access = await lockSpaceMembership(client, claims.identityId, locator)
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.lifecycle !== 'active') return { ok: false, fault: lifecycleFault(access.lifecycle) }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }

    const now = this.now()
    const id = randomUUID() as InvitationId
    const invitationSecret = this.invitationSecret(id)
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MILLISECONDS)
    await client.query(
      `insert into team.space_invitations
        (id, space_id, secret_hash, issued_by_member_id, issued_at, expires_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [id, access.id, digest(invitationSecret), access.member_id, now, expiresAt],
    )
    await recordAudit(client, access.id as SpaceId, claims.identityId, 'invitation-issued', now, { invitationId: id })
    return {
      ok: true,
      value: {
        result: {
          kind: 'invitation-issued',
          invitation: {
            id,
            issuedAt: now.toISOString() as Instant,
            expiresAt: expiresAt.toISOString() as Instant,
            state: 'pending',
          },
          invitationSecret,
        },
        session: { kind: 'unchanged' },
        accessRevision: Number(access.access_revision) as AccessRevision,
      },
    }
  }

  private async acceptInvitation(
    client: DbClient,
    claims: IdentityEvidence,
    invitationSecret: OpaqueSecret,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    if (!invitationSecret) return { ok: false, fault: { kind: 'invalid-invitation' } }
    const candidate = await client.query<InvitationRow>(
      'select id, space_id, issued_at, expires_at, revoked_at, accepted_at from team.space_invitations where secret_hash = $1',
      [digest(invitationSecret)],
    )
    const seen = candidate.rows[0]
    if (!seen) return { ok: false, fault: { kind: 'invalid-invitation' } }

    const spaceResult = await client.query<Omit<SpaceRow, 'role' | 'member_id'>>(
      `select id, space_key, display_name, time_zone, lifecycle, revision, access_revision
       from team.spaces where id = $1 for update`,
      [seen.space_id],
    )
    const space = spaceResult.rows[0]
    const invitationResult = await client.query<InvitationRow>(
      `select id, space_id, issued_at, expires_at, revoked_at, accepted_at
       from team.space_invitations where id = $1 and secret_hash = $2 for update`,
      [seen.id, digest(invitationSecret)],
    )
    const invitation = invitationResult.rows[0]
    const now = this.now()
    if (!space || !invitation || space.lifecycle !== 'active' || invitation.revoked_at
      || invitation.accepted_at || invitation.expires_at.getTime() <= now.getTime()) {
      return { ok: false, fault: { kind: 'invalid-invitation' } }
    }

    const existing = await client.query<{ id: string; ended_at: Date | null }>(
      `select id, ended_at from team.members
       where space_id = $1 and identity_id = $2 for update`,
      [space.id, claims.identityId],
    )
    if (existing.rows[0] && !existing.rows[0].ended_at) {
      return { ok: false, fault: { kind: 'invalid-invitation' } }
    }
    const member = existing.rows[0]
      ? await client.query<{ id: string }>(
          `update team.members set role = 'member', revision = revision + 1,
             joined_at = $3, ended_at = null where id = $1 and space_id = $2 returning id`,
          [existing.rows[0].id, space.id, now],
        )
      : await client.query<{ id: string }>(
          `insert into team.members (space_id, identity_id, role, joined_at)
           values ($1,$2,'member',$3) returning id`,
          [space.id, claims.identityId, now],
        )
    await client.query(
      `update team.space_invitations
       set accepted_at = $1, accepted_by_identity_id = $2 where id = $3`,
      [now, claims.identityId, invitation.id],
    )
    const revised = await client.query<{ access_revision: string | number }>(
      'update team.spaces set access_revision = access_revision + 1 where id = $1 returning access_revision',
      [space.id],
    )
    await recordAudit(client, space.id as SpaceId, claims.identityId, 'invitation-accepted', now, {
      subjectMemberId: member.rows[0].id as MemberId,
      invitationId: invitation.id as InvitationId,
    })
    const session = await this.sessions.replaceCurrent(client, claims, now)
    const summary = spaceSummary({
      ...space,
      access_revision: revised.rows[0].access_revision,
      role: 'member',
      member_id: member.rows[0].id,
    })
    return {
      ok: true,
      value: {
        result: { kind: 'invitation-accepted', space: summary },
        session,
        accessRevision: summary.accessRevision,
      },
    }
  }

  private async revokeInvitation(
    client: DbClient,
    claims: IdentityEvidence,
    locator: SpaceLocator,
    invitationId: InvitationId,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const access = await lockSpaceMembership(client, claims.identityId, locator)
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.lifecycle !== 'active') return { ok: false, fault: lifecycleFault(access.lifecycle) }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }

    const invitationResult = await client.query<InvitationRow>(
      `select id, space_id, issued_at, expires_at, revoked_at, accepted_at
       from team.space_invitations where id = $1 and space_id = $2 for update`,
      [invitationId, access.id],
    )
    const invitation = invitationResult.rows[0]
    if (!invitation) return { ok: false, fault: { kind: 'not-found' } }
    const now = this.now()
    if (!invitation.revoked_at && !invitation.accepted_at) {
      await client.query('update team.space_invitations set revoked_at = $1 where id = $2', [now, invitation.id])
      invitation.revoked_at = now
      await recordAudit(client, access.id as SpaceId, claims.identityId, 'invitation-revoked', now, {
        invitationId: invitation.id as InvitationId,
      })
    }
    return {
      ok: true,
      value: {
        result: { kind: 'invitation-revoked', invitation: invitationView(invitation, now) },
        session: { kind: 'unchanged' },
        accessRevision: Number(access.access_revision) as AccessRevision,
      },
    }
  }

  private async setMemberRole(
    client: DbClient,
    claims: IdentityEvidence,
    locator: SpaceLocator,
    versioned: VersionedMember,
    role: MemberRole,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const access = await lockSpaceMembership(client, claims.identityId, locator)
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.lifecycle !== 'active') return { ok: false, fault: lifecycleFault(access.lifecycle) }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }
    const targetResult = await client.query<{
      id: string
      identity_id: string
      role: MemberRole
      revision: number
      joined_at: Date
      display_name: string
    }>(
      `select member.id, member.identity_id, member.role, member.revision,
              member.joined_at, identity.display_name
       from team.members member
       join team.identities identity on identity.id = member.identity_id
       where member.id = $1 and member.space_id = $2 and member.ended_at is null
       for update of member`,
      [versioned.memberId, access.id],
    )
    const target = targetResult.rows[0]
    if (!target) return { ok: false, fault: { kind: 'not-found' } }
    if (target.revision !== versioned.expectedRevision) {
      return { ok: false, fault: { kind: 'conflict', reason: 'stale-member' } }
    }
    if (target.role === 'space-administrator' && role === 'member') {
      const administrators = await client.query<{ count: number }>(
        `select count(*)::int as count from team.members
         where space_id = $1 and ended_at is null and role = 'space-administrator'`,
        [access.id],
      )
      if (administrators.rows[0].count === 1) return { ok: false, fault: { kind: 'last-administrator' } }
    }

    if (target.role === role) {
      return {
        ok: true,
        value: {
          result: { kind: 'member-role-changed', member: memberView(target) },
          session: { kind: 'unchanged' },
          accessRevision: Number(access.access_revision) as AccessRevision,
        },
      }
    }

    const now = this.now()
    const updated = await client.query<{ revision: number }>(
      'update team.members set role = $1, revision = revision + 1 where id = $2 returning revision',
      [role, target.id],
    )
    target.role = role
    target.revision = updated.rows[0].revision
    const revised = await client.query<{ access_revision: string | number }>(
      'update team.spaces set access_revision = access_revision + 1 where id = $1 returning access_revision',
      [access.id],
    )
    const targetIdentityId = target.identity_id as IdentityId
    const session = targetIdentityId === claims.identityId
      ? await this.sessions.replaceCurrent(client, claims, now)
      : (await this.sessions.revokeAll(client, targetIdentityId, now), { kind: 'unchanged' as const })
    await recordAudit(client, access.id as SpaceId, claims.identityId, 'member-role-changed', now, {
      subjectMemberId: target.id as MemberId,
    })
    return {
      ok: true,
      value: {
        result: { kind: 'member-role-changed', member: memberView(target) },
        session,
        accessRevision: Number(revised.rows[0].access_revision) as AccessRevision,
      },
    }
  }

  private async leaveSpace(
    client: DbClient,
    claims: IdentityEvidence,
    locator: SpaceLocator,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const access = await lockSpaceMembership(client, claims.identityId, locator)
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.lifecycle !== 'active') return { ok: false, fault: lifecycleFault(access.lifecycle) }
    if (access.role === 'space-administrator') {
      const administrators = await client.query<{ count: number }>(
        `select count(*)::int as count from team.members
         where space_id = $1 and ended_at is null and role = 'space-administrator'`,
        [access.id],
      )
      if (administrators.rows[0].count === 1) return { ok: false, fault: { kind: 'last-administrator' } }
    }

    const now = this.now()
    await client.query(
      'update team.members set ended_at = $1, revision = revision + 1 where id = $2',
      [now, access.member_id],
    )
    const revised = await client.query<{ access_revision: string | number }>(
      'update team.spaces set access_revision = access_revision + 1 where id = $1 returning access_revision',
      [access.id],
    )
    const remaining = await client.query<{ count: number }>(
      'select count(*)::int as count from team.members where identity_id = $1 and ended_at is null',
      [claims.identityId],
    )
    const session: BrowserSessionDirective = claims.installationAdministrator || remaining.rows[0].count > 0
      ? await this.sessions.replaceCurrent(client, claims, now)
      : (await this.sessions.revokeAll(client, claims.identityId, now), { kind: 'clear' })
    await recordAudit(client, access.id as SpaceId, claims.identityId, 'member-left', now, {
      subjectMemberId: access.member_id as MemberId,
    })
    return {
      ok: true,
      value: {
        result: { kind: 'member-left', memberId: access.member_id as MemberId },
        session,
        accessRevision: Number(revised.rows[0].access_revision) as AccessRevision,
      },
    }
  }

  private async removeMember(
    client: DbClient,
    claims: IdentityEvidence,
    locator: SpaceLocator,
    versioned: VersionedMember,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const access = await lockSpaceMembership(client, claims.identityId, locator)
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.lifecycle !== 'active') return { ok: false, fault: lifecycleFault(access.lifecycle) }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }
    const targetResult = await client.query<{
      id: string
      identity_id: string
      role: MemberRole
      revision: number
    }>(
      `select id, identity_id, role, revision from team.members
       where id = $1 and space_id = $2 and ended_at is null for update`,
      [versioned.memberId, access.id],
    )
    const target = targetResult.rows[0]
    if (!target) return { ok: false, fault: { kind: 'not-found' } }
    if (target.revision !== versioned.expectedRevision) {
      return { ok: false, fault: { kind: 'conflict', reason: 'stale-member' } }
    }
    if (target.role === 'space-administrator') {
      const administrators = await client.query<{ count: number }>(
        `select count(*)::int as count from team.members
         where space_id = $1 and ended_at is null and role = 'space-administrator'`,
        [access.id],
      )
      if (administrators.rows[0].count === 1) return { ok: false, fault: { kind: 'last-administrator' } }
    }

    const now = this.now()
    await client.query(
      'update team.members set ended_at = $1, revision = revision + 1 where id = $2',
      [now, target.id],
    )
    const revised = await client.query<{ access_revision: string | number }>(
      'update team.spaces set access_revision = access_revision + 1 where id = $1 returning access_revision',
      [access.id],
    )
    const targetIdentityId = target.identity_id as IdentityId
    let session: BrowserSessionDirective = { kind: 'unchanged' }
    if (targetIdentityId === claims.identityId) {
      const remaining = await client.query<{ count: number }>(
        'select count(*)::int as count from team.members where identity_id = $1 and ended_at is null',
        [claims.identityId],
      )
      session = claims.installationAdministrator || remaining.rows[0].count > 0
        ? await this.sessions.replaceCurrent(client, claims, now)
        : (await this.sessions.revokeAll(client, claims.identityId, now), { kind: 'clear' })
    } else {
      await this.sessions.revokeAll(client, targetIdentityId, now)
    }
    await recordAudit(client, access.id as SpaceId, claims.identityId, 'member-removed', now, {
      subjectMemberId: target.id as MemberId,
    })
    return {
      ok: true,
      value: {
        result: { kind: 'member-removed', memberId: target.id as MemberId },
        session,
        accessRevision: Number(revised.rows[0].access_revision) as AccessRevision,
      },
    }
  }

  private async setSpaceLifecycle(
    client: DbClient,
    claims: IdentityEvidence,
    versioned: VersionedSpace,
    operation: 'archive' | 'restore',
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const access = await lockSpaceMembership(client, claims.identityId, {
      kind: 'id', spaceId: versioned.spaceId,
    })
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }
    if (access.revision !== versioned.expectedRevision) {
      return { ok: false, fault: { kind: 'conflict', reason: 'stale-space' } }
    }
    const expectedLifecycle = operation === 'archive' ? 'active' : 'archived'
    if (access.lifecycle !== expectedLifecycle) {
      return { ok: false, fault: { kind: 'conflict', reason: 'invalid-lifecycle' } }
    }

    const now = this.now()
    const lifecycle = operation === 'archive' ? 'archived' : 'active'
    const updated = await client.query<Omit<SpaceRow, 'role' | 'member_id'>>(
      `update team.spaces
       set lifecycle = $1, revision = revision + 1, access_revision = access_revision + 1,
           archived_at = $2, deletion_scheduled_for = null
       where id = $3
       returning id, space_key, display_name, time_zone, lifecycle, revision, access_revision`,
      [lifecycle, operation === 'archive' ? now : null, access.id],
    )
    if (operation === 'archive') {
      await client.query(
        `update team.space_invitations set revoked_at = $1
         where space_id = $2 and revoked_at is null and accepted_at is null`,
        [now, access.id],
      )
    }
    const action = operation === 'archive' ? 'space-archived' : 'space-restored'
    await recordAudit(client, access.id as SpaceId, claims.identityId, action, now)
    const summary = spaceSummary({ ...updated.rows[0], role: access.role, member_id: access.member_id })
    return {
      ok: true,
      value: {
        result: { kind: action, space: summary },
        session: { kind: 'unchanged' },
        accessRevision: summary.accessRevision,
      },
    }
  }

  private async reviseSpace(
    client: DbClient,
    claims: IdentityEvidence,
    versioned: VersionedSpace,
    changes: SpaceChanges,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const access = await lockSpaceMembership(client, claims.identityId, {
      kind: 'id', spaceId: versioned.spaceId,
    })
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.lifecycle !== 'active') return { ok: false, fault: lifecycleFault(access.lifecycle) }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }
    if (access.revision !== versioned.expectedRevision) {
      return { ok: false, fault: { kind: 'conflict', reason: 'stale-space' } }
    }
    const normalized = normalizeSpaceChanges(changes)
    const issues = validateSpaceChanges(normalized)
    if (issues.length > 0) return { ok: false, fault: { kind: 'invalid', issues } }

    const now = this.now()
    const updated = await client.query<Omit<SpaceRow, 'role' | 'member_id'>>(
      `update team.spaces
       set display_name = coalesce($1, display_name), time_zone = coalesce($2, time_zone),
           revision = revision + 1
       where id = $3
       returning id, space_key, display_name, time_zone, lifecycle, revision,
                 access_revision, deletion_scheduled_for`,
      [normalized.displayName ?? null, normalized.timeZone ?? null, access.id],
    )
    await recordAudit(client, access.id as SpaceId, claims.identityId, 'space-revised', now)
    const summary = spaceSummary({ ...updated.rows[0], role: access.role, member_id: access.member_id })
    return {
      ok: true,
      value: {
        result: { kind: 'space-revised', space: summary },
        session: { kind: 'unchanged' },
        accessRevision: summary.accessRevision,
      },
    }
  }

  private async changeDeletionSchedule(
    client: DbClient,
    claims: IdentityEvidence,
    versioned: VersionedSpace,
    operation: 'schedule' | 'cancel',
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>> {
    const access = await lockSpaceMembership(client, claims.identityId, {
      kind: 'id', spaceId: versioned.spaceId,
    })
    if (!access) return { ok: false, fault: { kind: 'not-found' } }
    if (access.role !== 'space-administrator') return { ok: false, fault: { kind: 'forbidden' } }
    if (access.revision !== versioned.expectedRevision) {
      return { ok: false, fault: { kind: 'conflict', reason: 'stale-space' } }
    }
    const expectedLifecycle = operation === 'schedule' ? 'archived' : 'deletion_scheduled'
    if (access.lifecycle !== expectedLifecycle) {
      return { ok: false, fault: { kind: 'conflict', reason: 'invalid-lifecycle' } }
    }

    const now = this.now()
    const scheduledFor = operation === 'schedule'
      ? new Date(now.getTime() + DELETION_GRACE_MILLISECONDS)
      : null
    const lifecycle = operation === 'schedule' ? 'deletion_scheduled' : 'archived'
    const updated = await client.query<Omit<SpaceRow, 'role' | 'member_id'>>(
      `update team.spaces
       set lifecycle = $1, deletion_scheduled_for = $2,
           revision = revision + 1, access_revision = access_revision + 1
       where id = $3
       returning id, space_key, display_name, time_zone, lifecycle, revision,
                 access_revision, deletion_scheduled_for`,
      [lifecycle, scheduledFor, access.id],
    )
    const action = operation === 'schedule' ? 'space-deletion-scheduled' : 'space-deletion-cancelled'
    await recordAudit(client, access.id as SpaceId, claims.identityId, action, now)
    const summary = spaceSummary({ ...updated.rows[0], role: access.role, member_id: access.member_id })
    return {
      ok: true,
      value: {
        result: { kind: action, space: summary },
        session: { kind: 'unchanged' },
        accessRevision: summary.accessRevision,
      },
    }
  }

  private invitationSecret(id: InvitationId): OpaqueSecret {
    const mac = createHmac('sha256', this.config.invitationHmacSecret).update(`invitation:${id}`).digest('base64url')
    return `${id}.${mac}` as OpaqueSecret
  }

  private async publishAccessInvalidation(command: SpaceCommand, receipt: SpaceChangeReceipt): Promise<void> {
    const reason = invalidationReason(command)
    if (!reason || !this.config.accessInvalidation) return
    try {
      let spaceId: SpaceId | undefined
      if ('space' in receipt.result) spaceId = receipt.result.space.id
      else if ('space' in command && 'kind' in command.space) {
        if (command.space.kind === 'id') spaceId = command.space.spaceId
        else {
          const result = await this.db.query<{ id: string }>(
            'select id from team.spaces where space_key = $1',
            [command.space.spaceKey],
          )
          spaceId = result.rows[0]?.id as SpaceId | undefined
        }
      }
      if (!spaceId) return
      await this.config.accessInvalidation.publish({
        spaceId,
        accessRevision: receipt.accessRevision,
        reason,
      })
    } catch {
      // Heartbeat access checks recover if an optional live-feed notification is missed.
    }
  }

  private restoreStoredReceipt(receipt: SpaceChangeReceipt): SpaceChangeReceipt {
    if (receipt.result.kind !== 'invitation-issued') return receipt
    return {
      ...receipt,
      result: { ...receipt.result, invitationSecret: this.invitationSecret(receipt.result.invitation.id) },
    }
  }

  private async findSpace(identityId: IdentityId, locator: SpaceLocator): Promise<SpaceRow | undefined> {
    const value = locatorValue(locator)
    const column = locator.kind === 'id' ? 'space.id' : 'space.space_key'
    const result = await this.db.query<SpaceRow>(
      `select space.id, space.space_key, space.display_name, space.time_zone,
              space.lifecycle, space.revision, space.access_revision,
              member.id as member_id, member.role, space.deletion_scheduled_for
       from team.spaces space
       join team.members member on member.space_id = space.id
       where ${column} = $1 and member.identity_id = $2 and member.ended_at is null`,
      [value, identityId],
    )
    return result.rows[0]
  }
}

async function lockSpaceMembership(
  client: DbClient,
  identityId: IdentityId,
  locator: SpaceLocator,
): Promise<SpaceRow | undefined> {
  const column = locator.kind === 'id' ? 'id' : 'space_key'
  const spaceResult = await client.query<Omit<SpaceRow, 'role' | 'member_id'>>(
    `select id, space_key, display_name, time_zone, lifecycle, revision, access_revision,
            deletion_scheduled_for
     from team.spaces where ${column} = $1 for update`,
    [locatorValue(locator)],
  )
  const space = spaceResult.rows[0]
  if (!space) return undefined
  const memberResult = await client.query<{ id: string; role: MemberRole }>(
    `select id, role from team.members
     where space_id = $1 and identity_id = $2 and ended_at is null for update`,
    [space.id, identityId],
  )
  const member = memberResult.rows[0]
  return member ? { ...space, role: member.role, member_id: member.id } : undefined
}

async function recordAudit(
  client: DbClient,
  spaceId: SpaceId,
  actorIdentityId: IdentityId,
  action: SpaceAuditAction,
  occurredAt: Date,
  references: { subjectMemberId?: MemberId; invitationId?: InvitationId } = {},
) {
  await client.query(
    `insert into team.space_audit
      (space_id, actor_identity_id, action, subject_member_id, invitation_id, occurred_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [spaceId, actorIdentityId, action, references.subjectMemberId ?? null, references.invitationId ?? null, occurredAt],
  )
}

function normalizeCommand(command: SpaceCommand): SpaceCommand {
  if (command.kind === 'create-space') {
    return {
      kind: 'create-space',
      input: {
        displayName: typeof command.input.displayName === 'string' ? command.input.displayName.trim() : '',
        key: typeof command.input.key === 'string' ? command.input.key.trim().toUpperCase() : '',
        timeZone: typeof command.input.timeZone === 'string' ? command.input.timeZone.trim() : '',
      },
    }
  }
  if (command.kind === 'revise-space') {
    return { ...command, changes: normalizeSpaceChanges(command.changes) }
  }
  return command
}

function normalizeSpaceChanges(changes: SpaceChanges): SpaceChanges {
  return {
    displayName: typeof changes.displayName === 'string' ? changes.displayName.trim() : undefined,
    timeZone: typeof changes.timeZone === 'string' ? changes.timeZone.trim() : undefined,
  }
}

function validateSpaceChanges(changes: SpaceChanges): FieldIssue[] {
  const issues: FieldIssue[] = []
  if (changes.displayName !== undefined && (changes.displayName.length < 1 || changes.displayName.length > 60)) {
    issues.push({ field: 'displayName', message: 'Use 1 to 60 characters.' })
  }
  if (changes.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: changes.timeZone }).format()
    } catch {
      issues.push({ field: 'timeZone', message: 'Use an IANA time zone such as Europe/Oslo.' })
    }
  }
  if (changes.displayName === undefined && changes.timeZone === undefined) {
    issues.push({ field: 'changes', message: 'Change the Space name or time zone.' })
  }
  return issues
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

function hashCommand(command: SpaceCommand): string {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex')
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function storedReceipt(receipt: SpaceChangeReceipt): SpaceChangeReceipt {
  const session: BrowserSessionDirective = receipt.session.kind === 'replace' || receipt.session.kind === 'establish'
    ? { kind: 'unchanged' }
    : receipt.session
  if (receipt.result.kind !== 'invitation-issued') return { ...receipt, session }
  return {
    ...receipt,
    result: { ...receipt.result, invitationSecret: '' as OpaqueSecret },
    session,
  }
}

function invitationView(row: InvitationRow, now: Date): InvitationView {
  return {
    id: row.id as InvitationId,
    issuedAt: row.issued_at.toISOString() as Instant,
    expiresAt: row.expires_at.toISOString() as Instant,
    state: row.revoked_at
      ? 'revoked'
      : row.accepted_at
        ? 'accepted'
        : row.expires_at.getTime() <= now.getTime()
          ? 'expired'
          : 'pending',
  }
}

function memberView(row: {
  id: string
  display_name: string
  role: MemberRole
  revision: number
  joined_at: Date
}): MemberView {
  return {
    id: row.id as MemberId,
    displayName: row.display_name,
    role: row.role,
    revision: row.revision as Revision,
    joinedAt: row.joined_at.toISOString() as Instant,
  }
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
    deletionScheduledFor: row.deletion_scheduled_for?.toISOString() as Instant | undefined,
  }
}

function locatorValue(locator: SpaceLocator): string {
  return locator.kind === 'id' ? locator.spaceId : locator.spaceKey.toUpperCase()
}

function lifecycleFault(lifecycle: SpaceSummary['lifecycle']): Extract<SpaceFault, { kind: 'read-only' }> {
  return { kind: 'read-only', reason: lifecycle === 'archived' ? 'space-archived' : 'deletion-scheduled' }
}

function invalidationReason(command: SpaceCommand): SpaceAccessInvalidation['reason'] | undefined {
  switch (command.kind) {
    case 'accept-invitation':
    case 'set-member-role':
    case 'remove-member':
    case 'leave-space':
      return 'membership-changed'
    case 'archive-space':
    case 'restore-space':
    case 'schedule-space-deletion':
    case 'cancel-space-deletion':
      return 'space-lifecycle-changed'
    default:
      return undefined
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

interface TimelineCursor {
  version: 1
  kind: 'invitations' | 'audit'
  spaceId: string
  time: string
  tieBreaker: string
}

interface MemberCursor {
  version: 1
  kind: 'members'
  spaceId: string
  name: string
  id: string
}

function pageSize(page: PageRequest | undefined): Result<number, SpaceFault> {
  if (page?.size !== undefined && (!Number.isInteger(page.size) || page.size < 1)) {
    return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'page.size', message: 'Use a positive whole number.' }] } }
  }
  return { ok: true, value: Math.min(page?.size ?? 50, 200) }
}

function decodeTimelineCursor(
  value: OpaqueCursor | undefined,
  kind: TimelineCursor['kind'],
  spaceId: string,
): Result<TimelineCursor | undefined, SpaceFault> {
  if (!value) return { ok: true, value: undefined }
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<TimelineCursor>
    if (cursor.version !== 1 || cursor.kind !== kind || cursor.spaceId !== spaceId
      || typeof cursor.time !== 'string' || Number.isNaN(Date.parse(cursor.time))
      || typeof cursor.tieBreaker !== 'string') {
      throw new Error('invalid cursor')
    }
    return { ok: true, value: cursor as TimelineCursor }
  } catch {
    return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'page.after', message: 'Use a cursor from the previous page.' }] } }
  }
}

function decodeMemberCursor(
  value: OpaqueCursor | undefined,
  spaceId: string,
): Result<MemberCursor | undefined, SpaceFault> {
  if (!value) return { ok: true, value: undefined }
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<MemberCursor>
    if (cursor.version !== 1 || cursor.kind !== 'members' || cursor.spaceId !== spaceId
      || typeof cursor.name !== 'string' || typeof cursor.id !== 'string') throw new Error('invalid cursor')
    return { ok: true, value: cursor as MemberCursor }
  } catch {
    return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'page.after', message: 'Use a cursor from the previous page.' }] } }
  }
}

function encodeMemberCursor(spaceId: string, name: string, id: string): OpaqueCursor {
  return Buffer.from(JSON.stringify({
    version: 1,
    kind: 'members',
    spaceId,
    name,
    id,
  } satisfies MemberCursor)).toString('base64url') as OpaqueCursor
}

function encodeTimelineCursor(
  kind: TimelineCursor['kind'],
  spaceId: string,
  time: Date,
  tieBreaker: string,
): OpaqueCursor {
  return Buffer.from(JSON.stringify({
    version: 1,
    kind,
    spaceId,
    time: time.toISOString(),
    tieBreaker,
  } satisfies TimelineCursor)).toString('base64url') as OpaqueCursor
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
