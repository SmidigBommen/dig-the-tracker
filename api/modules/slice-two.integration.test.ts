// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createDatabase, type Database } from '../db.js'
import type { AppConfig } from '../config.js'
import { createTeamServer } from '../server.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import { BoardModuleImplementation } from './board/board-module.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import type { OpaqueSecret, RequestId, SpaceKey } from './shared.js'
import { SpaceModuleImplementation } from './space/space-module.js'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://dig:dig-local-only@127.0.0.1:5432/dig'
const origin = 'https://dig.example.test'
const identityKey = (subject: string) => `https://identity.example.test|${subject}`

let db: Database
let now: Date

run('Slice 2 membership and Space lifecycle', () => {
  beforeAll(() => {
    db = createDatabase(databaseUrl)
  })

  beforeEach(async () => {
    now = new Date('2026-09-04T08:00:00.000Z')
    await db.query(`truncate table
      team.space_request_receipts,
      team.board_columns,
      team.boards,
      team.members,
      team.spaces,
      team.space_key_reservations,
      team.browser_sessions,
      team.sign_in_attempts,
      team.identities
      restart identity cascade`)
  })

  afterAll(async () => {
    await db.end()
  })

  function modules(subject: string, accessInvalidation?: {
    publish(event: { spaceId: string; accessRevision: number; reason: string }): Promise<void>
  }) {
    const oidc = new MockOidcAdapter({
      issuer: 'https://identity.example.test',
      subject,
      displayName: subject === 'admin' ? 'Ada Admin' : 'Mira Member',
      email: `${subject}@example.test`,
    })
    return {
      identity: new IdentityModuleImplementation(db, oidc, {
        redirectUri: `${origin}/api/auth/callback`,
        allowedOrigins: new Set([origin]),
        installationAdministrators: new Set([identityKey('admin')]),
        sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
        now: () => now,
      }),
      space: new SpaceModuleImplementation(db, {
        invitationHmacSecret: 'test-invitation-hmac-secret-with-32-bytes',
        sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
        accessInvalidation,
        now: () => now,
      }),
      board: new BoardModuleImplementation(db),
    }
  }

  async function signIn(subject: string, accessInvalidation?: Parameters<typeof modules>[1]) {
    const result = modules(subject, accessInvalidation)
    const begun = await result.identity.signIn({ kind: 'begin', returnTo: '/' as never })
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in did not begin')
    const state = new URL(begun.value.authorizationUrl).searchParams.get('state') ?? ''
    const completed = await result.identity.signIn({
      kind: 'complete',
      attemptSecret: begun.value.attemptSecret,
      callback: { code: 'accepted-code', state },
    })
    if (!completed.ok || completed.value.kind !== 'established') throw new Error('Sign-in did not complete')
    const session = await result.identity.session({
      kind: 'resolve',
      use: 'change',
      evidence: {
        sessionSecret: completed.value.session.sessionSecret,
        csrfToken: completed.value.session.csrfToken,
        origin,
      },
    })
    if (!session.ok || session.value.kind !== 'resolved') throw new Error('Session did not resolve')
    return { ...result, session: session.value, browserSession: completed.value.session }
  }

  async function createSpace(admin: Awaited<ReturnType<typeof signIn>>) {
    const created = await admin.space.change(admin.session.identity, {
      requestId: 'create-space' as RequestId,
      command: {
        kind: 'create-space',
        input: { displayName: 'Delivery', key: 'DIG', timeZone: 'Europe/Oslo' },
      },
    })
    if (!created.ok) throw new Error('Space was not created')
    return created.value.result.kind === 'space-created' ? created.value.result.space : neverReached()
  }

  it('lets an authenticated recipient accept a single-use invitation and open the Board', async () => {
    const admin = await signIn('admin')
    await createSpace(admin)

    const issued = await admin.space.change(admin.session.identity, {
      requestId: 'issue-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey } },
    })
    expect(issued.ok).toBe(true)
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')

    const recipient = await signIn('member')
    const accepted = await recipient.space.change(recipient.session.identity, {
      requestId: 'accept-invitation' as RequestId,
      command: {
        kind: 'accept-invitation',
        invitationSecret: issued.value.result.invitationSecret as OpaqueSecret,
      },
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok || accepted.value.session.kind !== 'replace') throw new Error('Session was not replaced')

    const oldSession = await recipient.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: recipient.browserSession.sessionSecret },
    })
    expect(oldSession).toEqual({ ok: false, fault: { kind: 'not-authenticated' } })
    const replacement = await recipient.identity.session({
      kind: 'resolve',
      use: 'read',
      evidence: { sessionSecret: accepted.value.session.sessionSecret },
    })
    if (!replacement.ok || replacement.value.kind !== 'resolved') throw new Error('Replacement session did not resolve')

    const space = await recipient.space.read(replacement.value.identity, {
      kind: 'space',
      space: { kind: 'key', spaceKey: 'DIG' as SpaceKey },
    })
    expect(space.ok && space.value.kind === 'space' && space.value.space.memberRole).toBe('member')

    const authorized = await recipient.space.authorize(replacement.value.identity, {
      space: { kind: 'key', spaceKey: 'DIG' as SpaceKey },
      use: 'board-read',
    })
    if (!authorized.ok) throw new Error('Recipient could not authorize the Space')
    const board = await recipient.board.read(authorized.value, { kind: 'overview' })
    expect(board.ok && board.value.kind === 'overview' && board.value.value.members).toHaveLength(2)

    const replay = await recipient.space.change(replacement.value.identity, {
      requestId: 'accept-replay' as RequestId,
      command: {
        kind: 'accept-invitation',
        invitationSecret: issued.value.result.invitationSecret as OpaqueSecret,
      },
    })
    expect(replay).toEqual({ ok: false, fault: { kind: 'invalid-invitation' } })
  })

  it('expires and revokes invitations without revealing their state', async () => {
    const admin = await signIn('admin')
    await createSpace(admin)
    const request = {
      requestId: 'expiring-invitation' as RequestId,
      command: { kind: 'issue-invitation' as const, space: { kind: 'key' as const, spaceKey: 'DIG' as SpaceKey } },
    }
    const issued = await admin.space.change(admin.session.identity, request)
    const retry = await admin.space.change(admin.session.identity, request)
    expect(retry).toEqual(issued)
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')

    now = new Date('2026-09-11T08:00:00.000Z')
    const recipient = await signIn('member')
    const expired = await recipient.space.change(recipient.session.identity, {
      requestId: 'expired-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: issued.value.result.invitationSecret },
    })
    expect(expired).toEqual({ ok: false, fault: { kind: 'invalid-invitation' } })

    now = new Date('2026-09-11T08:00:01.000Z')
    const fresh = await admin.space.change(admin.session.identity, {
      requestId: 'fresh-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey } },
    })
    if (!fresh.ok || fresh.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    const revoked = await admin.space.change(admin.session.identity, {
      requestId: 'revoke-invitation' as RequestId,
      command: {
        kind: 'revoke-invitation',
        space: { kind: 'key', spaceKey: 'DIG' as SpaceKey },
        invitationId: fresh.value.result.invitation.id,
      },
    })
    expect(revoked.ok).toBe(true)
    const denied = await recipient.space.change(recipient.session.identity, {
      requestId: 'revoked-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: fresh.value.result.invitationSecret },
    })
    expect(denied).toEqual({ ok: false, fault: { kind: 'invalid-invitation' } })

    const unknown = await recipient.space.change(recipient.session.identity, {
      requestId: 'unknown-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: 'unknown' as OpaqueSecret },
    })
    expect(unknown).toEqual({ ok: false, fault: { kind: 'invalid-invitation' } })
  })

  it('preserves the last administrator and rotates sessions after role changes', async () => {
    const admin = await signIn('admin')
    const created = await createSpace(admin)
    const issued = await admin.space.change(admin.session.identity, {
      requestId: 'role-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
    })
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    const member = await signIn('member')
    const accepted = await member.space.change(member.session.identity, {
      requestId: 'role-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: issued.value.result.invitationSecret },
    })
    if (!accepted.ok || accepted.value.session.kind !== 'replace') throw new Error('Invitation was not accepted')

    const members = await admin.space.read(admin.session.identity, {
      kind: 'members', space: { kind: 'id', spaceId: created.id },
    })
    if (!members.ok || members.value.kind !== 'members') throw new Error('Members did not load')
    const adminMember = members.value.members.find((entry) => entry.displayName === 'Ada Admin')!
    const teammate = members.value.members.find((entry) => entry.displayName === 'Mira Member')!

    const denied = await admin.space.change(admin.session.identity, {
      requestId: 'demote-last-admin' as RequestId,
      command: {
        kind: 'set-member-role',
        space: { kind: 'id', spaceId: created.id },
        member: { memberId: adminMember.id, expectedRevision: adminMember.revision },
        role: 'member',
      },
    })
    expect(denied).toEqual({ ok: false, fault: { kind: 'last-administrator' } })

    const promoted = await admin.space.change(admin.session.identity, {
      requestId: 'promote-member' as RequestId,
      command: {
        kind: 'set-member-role',
        space: { kind: 'id', spaceId: created.id },
        member: { memberId: teammate.id, expectedRevision: teammate.revision },
        role: 'space-administrator',
      },
    })
    expect(promoted.ok).toBe(true)
    const teammateOldSession = await member.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: accepted.value.session.sessionSecret },
    })
    expect(teammateOldSession).toEqual({ ok: false, fault: { kind: 'not-authenticated' } })

    const demotionRequest = {
      requestId: 'demote-self' as RequestId,
      command: {
        kind: 'set-member-role' as const,
        space: { kind: 'id', spaceId: created.id },
        member: { memberId: adminMember.id, expectedRevision: adminMember.revision },
        role: 'member' as const,
      },
    }
    const demoted = await admin.space.change(admin.session.identity, demotionRequest)
    expect(demoted.ok).toBe(true)
    if (!demoted.ok || demoted.value.session.kind !== 'replace') throw new Error('Administrator session was not replaced')
    const oldAdminSession = await admin.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: admin.browserSession.sessionSecret },
    })
    expect(oldAdminSession).toEqual({ ok: false, fault: { kind: 'not-authenticated' } })
    const newAdminSession = await admin.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: demoted.value.session.sessionSecret },
    })
    expect(newAdminSession.ok).toBe(true)
    const replayed = await admin.space.change(admin.session.identity, demotionRequest)
    expect(replayed.ok && replayed.value.session).toEqual({ kind: 'unchanged' })
  })

  it('ends membership and rejects an AuthorizedSpace captured before the change', async () => {
    const admin = await signIn('admin')
    const created = await createSpace(admin)
    const issued = await admin.space.change(admin.session.identity, {
      requestId: 'leave-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
    })
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    const member = await signIn('member')
    const accepted = await member.space.change(member.session.identity, {
      requestId: 'leave-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: issued.value.result.invitationSecret },
    })
    if (!accepted.ok) throw new Error('Invitation was not accepted')
    const members = await admin.space.read(admin.session.identity, {
      kind: 'members', space: { kind: 'id', spaceId: created.id },
    })
    if (!members.ok || members.value.kind !== 'members') throw new Error('Members did not load')
    const teammate = members.value.members.find((entry) => entry.displayName === 'Mira Member')!
    const promoted = await admin.space.change(admin.session.identity, {
      requestId: 'leave-promote' as RequestId,
      command: {
        kind: 'set-member-role',
        space: { kind: 'id', spaceId: created.id },
        member: { memberId: teammate.id, expectedRevision: teammate.revision },
        role: 'space-administrator',
      },
    })
    if (!promoted.ok) throw new Error('Member was not promoted')

    const staleAccess = await admin.space.authorize(admin.session.identity, {
      space: { kind: 'id', spaceId: created.id }, use: 'board-read',
    })
    if (!staleAccess.ok) throw new Error('Space was not authorized')
    const left = await admin.space.change(admin.session.identity, {
      requestId: 'admin-leaves' as RequestId,
      command: { kind: 'leave-space', space: { kind: 'id', spaceId: created.id } },
    })
    expect(left.ok).toBe(true)
    if (!left.ok || left.value.session.kind !== 'replace') throw new Error('Leaving did not replace the session')
    expect(await admin.board.read(staleAccess.value, { kind: 'overview' })).toEqual({
      ok: false, fault: { kind: 'forbidden' },
    })
    const replacement = await admin.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: left.value.session.sessionSecret },
    })
    if (!replacement.ok || replacement.value.kind !== 'resolved') throw new Error('Replacement session did not resolve')
    expect(await admin.space.read(replacement.value.identity, {
      kind: 'space', space: { kind: 'id', spaceId: created.id },
    })).toEqual({ ok: false, fault: { kind: 'not-found' } })

    const promotedMember = await signIn('member')
    const currentMembers = await promotedMember.space.read(promotedMember.session.identity, {
      kind: 'members', space: { kind: 'id', spaceId: created.id },
    })
    if (!currentMembers.ok || currentMembers.value.kind !== 'members') throw new Error('Members did not load')
    const lastAdministrator = currentMembers.value.members[0]
    const denied = await promotedMember.space.change(promotedMember.session.identity, {
      requestId: 'last-admin-leaves' as RequestId,
      command: { kind: 'leave-space', space: { kind: 'id', spaceId: created.id } },
    })
    expect(denied).toEqual({ ok: false, fault: { kind: 'last-administrator' } })
    expect(lastAdministrator.role).toBe('space-administrator')
  })

  it('removes a Member idempotently and conceals cross-Space Member identifiers', async () => {
    const admin = await signIn('admin')
    const created = await createSpace(admin)
    const issued = await admin.space.change(admin.session.identity, {
      requestId: 'remove-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
    })
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    const member = await signIn('member')
    const accepted = await member.space.change(member.session.identity, {
      requestId: 'remove-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: issued.value.result.invitationSecret },
    })
    if (!accepted.ok || accepted.value.session.kind !== 'replace') throw new Error('Invitation was not accepted')
    const recipientSession = await member.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: accepted.value.session.sessionSecret },
    })
    if (!recipientSession.ok || recipientSession.value.kind !== 'resolved') throw new Error('Recipient session failed')
    const staleAccess = await member.space.authorize(recipientSession.value.identity, {
      space: { kind: 'id', spaceId: created.id }, use: 'board-read',
    })
    if (!staleAccess.ok) throw new Error('Recipient could not open Space')

    const members = await admin.space.read(admin.session.identity, {
      kind: 'members', space: { kind: 'id', spaceId: created.id },
    })
    if (!members.ok || members.value.kind !== 'members') throw new Error('Members did not load')
    const teammate = members.value.members.find((entry) => entry.displayName === 'Mira Member')!
    const other = await admin.space.change(admin.session.identity, {
      requestId: 'other-space' as RequestId,
      command: { kind: 'create-space', input: { displayName: 'Other', key: 'OTH', timeZone: 'UTC' } },
    })
    if (!other.ok || other.value.result.kind !== 'space-created') throw new Error('Other Space was not created')
    const otherMembers = await admin.space.read(admin.session.identity, {
      kind: 'members', space: { kind: 'id', spaceId: other.value.result.space.id },
    })
    if (!otherMembers.ok || otherMembers.value.kind !== 'members') throw new Error('Other members did not load')

    const crossSpace = await admin.space.change(admin.session.identity, {
      requestId: 'cross-space-removal' as RequestId,
      command: {
        kind: 'remove-member',
        space: { kind: 'id', spaceId: created.id },
        member: {
          memberId: otherMembers.value.members[0].id,
          expectedRevision: otherMembers.value.members[0].revision,
        },
      },
    })
    expect(crossSpace).toEqual({ ok: false, fault: { kind: 'not-found' } })

    const request = {
      requestId: 'remove-member' as RequestId,
      command: {
        kind: 'remove-member' as const,
        space: { kind: 'id' as const, spaceId: created.id },
        member: { memberId: teammate.id, expectedRevision: teammate.revision },
      },
    }
    const removed = await admin.space.change(admin.session.identity, request)
    expect(removed.ok).toBe(true)
    expect(await admin.space.change(admin.session.identity, request)).toEqual(removed)
    expect(await member.board.read(staleAccess.value, { kind: 'overview' })).toEqual({
      ok: false, fault: { kind: 'forbidden' },
    })
    expect(await member.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: accepted.value.session.sessionSecret },
    })).toEqual({ ok: false, fault: { kind: 'not-authenticated' } })
    const audit = await admin.space.read(admin.session.identity, {
      kind: 'audit', space: { kind: 'id', spaceId: created.id },
    })
    expect(audit.ok && audit.value.kind === 'audit' && audit.value.entries[0]).toMatchObject({
      action: 'member-removed', subjectMemberId: teammate.id,
    })
  })

  it('serializes Board reads racing with Member removal and Space archive', async () => {
    const admin = await signIn('admin')
    const created = await createSpace(admin)
    const issued = await admin.space.change(admin.session.identity, {
      requestId: 'race-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
    })
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    const member = await signIn('member')
    const accepted = await member.space.change(member.session.identity, {
      requestId: 'race-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: issued.value.result.invitationSecret },
    })
    if (!accepted.ok || accepted.value.session.kind !== 'replace') throw new Error('Invitation was not accepted')
    const resolved = await member.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: accepted.value.session.sessionSecret },
    })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Member session did not resolve')
    const memberAccess = await member.space.authorize(resolved.value.identity, {
      space: { kind: 'id', spaceId: created.id }, use: 'board-read',
    })
    if (!memberAccess.ok) throw new Error('Member access was not authorized')
    const members = await admin.space.read(admin.session.identity, {
      kind: 'members', space: { kind: 'id', spaceId: created.id },
    })
    if (!members.ok || members.value.kind !== 'members') throw new Error('Members did not load')
    const teammate = members.value.members.find((entry) => entry.displayName === 'Mira Member')!

    const [racingRead, removed] = await Promise.all([
      member.board.read(memberAccess.value, { kind: 'overview' }),
      admin.space.change(admin.session.identity, {
        requestId: 'racing-removal' as RequestId,
        command: {
          kind: 'remove-member', space: { kind: 'id', spaceId: created.id },
          member: { memberId: teammate.id, expectedRevision: teammate.revision },
        },
      }),
    ])
    expect(removed.ok).toBe(true)
    expect(racingRead.ok || racingRead.fault.kind === 'forbidden').toBe(true)
    expect(await member.board.read(memberAccess.value, { kind: 'overview' })).toEqual({
      ok: false, fault: { kind: 'forbidden' },
    })

    const adminAccess = await admin.space.authorize(admin.session.identity, {
      space: { kind: 'id', spaceId: created.id }, use: 'board-read',
    })
    if (!adminAccess.ok) throw new Error('Administrator access was not authorized')
    const current = await admin.space.read(admin.session.identity, {
      kind: 'space', space: { kind: 'id', spaceId: created.id },
    })
    if (!current.ok || current.value.kind !== 'space') throw new Error('Space did not load')
    const [archiveRaceRead, archived] = await Promise.all([
      admin.board.read(adminAccess.value, { kind: 'overview' }),
      admin.space.change(admin.session.identity, {
        requestId: 'racing-archive' as RequestId,
        command: {
          kind: 'archive-space',
          space: { spaceId: created.id, expectedRevision: current.value.space.revision },
        },
      }),
    ])
    expect(archived.ok).toBe(true)
    expect(archiveRaceRead.ok || archiveRaceRead.fault.kind === 'forbidden').toBe(true)
    expect(await admin.board.read(adminAccess.value, { kind: 'overview' })).toEqual({
      ok: false, fault: { kind: 'forbidden' },
    })
  })

  it('archives and restores a Space while revoking invitations and invalidating old access', async () => {
    const admin = await signIn('admin')
    const created = await createSpace(admin)
    const issued = await admin.space.change(admin.session.identity, {
      requestId: 'archive-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
    })
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    const oldAccess = await admin.space.authorize(admin.session.identity, {
      space: { kind: 'id', spaceId: created.id }, use: 'board-read',
    })
    if (!oldAccess.ok) throw new Error('Space was not authorized')

    const archived = await admin.space.change(admin.session.identity, {
      requestId: 'archive-space' as RequestId,
      command: {
        kind: 'archive-space',
        space: { spaceId: created.id, expectedRevision: created.revision },
      },
    })
    expect(archived.ok).toBe(true)
    if (!archived.ok || archived.value.result.kind !== 'space-archived') throw new Error('Space was not archived')
    expect(archived.value.result.space.lifecycle).toBe('archived')
    expect(await admin.board.read(oldAccess.value, { kind: 'overview' })).toEqual({
      ok: false, fault: { kind: 'forbidden' },
    })

    const archivedAccess = await admin.space.authorize(admin.session.identity, {
      space: { kind: 'id', spaceId: created.id }, use: 'board-read',
    })
    if (!archivedAccess.ok) throw new Error('Archived Space was not readable')
    const archivedBoard = await admin.board.read(archivedAccess.value, { kind: 'overview' })
    expect(archivedBoard.ok && archivedBoard.value.kind === 'overview' && archivedBoard.value.value.space.lifecycle).toBe('archived')
    expect(await admin.space.authorize(admin.session.identity, {
      space: { kind: 'id', spaceId: created.id }, use: 'board-change',
    })).toEqual({ ok: false, fault: { kind: 'read-only', reason: 'space-archived' } })
    expect(await admin.space.change(admin.session.identity, {
      requestId: 'archived-leave' as RequestId,
      command: { kind: 'leave-space', space: { kind: 'id', spaceId: created.id } },
    })).toEqual({ ok: false, fault: { kind: 'read-only', reason: 'space-archived' } })

    const recipient = await signIn('member')
    expect(await recipient.space.change(recipient.session.identity, {
      requestId: 'archived-invitation' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: issued.value.result.invitationSecret },
    })).toEqual({ ok: false, fault: { kind: 'invalid-invitation' } })

    const restored = await admin.space.change(admin.session.identity, {
      requestId: 'restore-space' as RequestId,
      command: {
        kind: 'restore-space',
        space: {
          spaceId: archived.value.result.space.id,
          expectedRevision: archived.value.result.space.revision,
        },
      },
    })
    expect(restored.ok && restored.value.result.kind === 'space-restored'
      && restored.value.result.space.lifecycle).toBe('active')
  })

  it('revises Space settings and gives deletion a seven-day cancellation period', async () => {
    const admin = await signIn('admin')
    const created = await createSpace(admin)
    const revised = await admin.space.change(admin.session.identity, {
      requestId: 'revise-space' as RequestId,
      command: {
        kind: 'revise-space',
        space: { spaceId: created.id, expectedRevision: created.revision },
        changes: { displayName: 'Delivery Flow', timeZone: 'America/Toronto' },
      },
    })
    expect(revised.ok && revised.value.result.kind === 'space-revised'
      && revised.value.result.space).toMatchObject({
        displayName: 'Delivery Flow', timeZone: 'America/Toronto', revision: 2,
      })
    if (!revised.ok || revised.value.result.kind !== 'space-revised') throw new Error('Space was not revised')
    expect(await admin.space.change(admin.session.identity, {
      requestId: 'stale-space' as RequestId,
      command: {
        kind: 'revise-space',
        space: { spaceId: created.id, expectedRevision: created.revision },
        changes: { displayName: 'Stale' },
      },
    })).toEqual({ ok: false, fault: { kind: 'conflict', reason: 'stale-space' } })

    const archived = await admin.space.change(admin.session.identity, {
      requestId: 'archive-before-delete' as RequestId,
      command: {
        kind: 'archive-space',
        space: { spaceId: created.id, expectedRevision: revised.value.result.space.revision },
      },
    })
    if (!archived.ok || archived.value.result.kind !== 'space-archived') throw new Error('Space was not archived')
    const scheduled = await admin.space.change(admin.session.identity, {
      requestId: 'schedule-delete' as RequestId,
      command: {
        kind: 'schedule-space-deletion',
        space: { spaceId: created.id, expectedRevision: archived.value.result.space.revision },
      },
    })
    expect(scheduled.ok && scheduled.value.result.kind === 'space-deletion-scheduled'
      && scheduled.value.result.space).toMatchObject({
        lifecycle: 'deletion_scheduled', deletionScheduledFor: '2026-09-11T08:00:00.000Z',
      })
    if (!scheduled.ok || scheduled.value.result.kind !== 'space-deletion-scheduled') throw new Error('Deletion was not scheduled')
    expect(await admin.space.authorize(admin.session.identity, {
      space: { kind: 'id', spaceId: created.id }, use: 'board-change',
    })).toEqual({ ok: false, fault: { kind: 'read-only', reason: 'deletion-scheduled' } })

    const cancelled = await admin.space.change(admin.session.identity, {
      requestId: 'cancel-delete' as RequestId,
      command: {
        kind: 'cancel-space-deletion',
        space: { spaceId: created.id, expectedRevision: scheduled.value.result.space.revision },
      },
    })
    expect(cancelled.ok && cancelled.value.result.kind === 'space-deletion-cancelled'
      && cancelled.value.result.space).toMatchObject({ lifecycle: 'archived' })
  })

  it('shows invitation state and immutable audit only to Space administrators', async () => {
    const admin = await signIn('admin')
    const created = await createSpace(admin)
    const issued = await admin.space.change(admin.session.identity, {
      requestId: 'audit-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
    })
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    await admin.space.change(admin.session.identity, {
      requestId: 'audit-revoke' as RequestId,
      command: {
        kind: 'revoke-invitation',
        space: { kind: 'id', spaceId: created.id },
        invitationId: issued.value.result.invitation.id,
      },
    })
    const invitations = await admin.space.read(admin.session.identity, {
      kind: 'invitations', space: { kind: 'id', spaceId: created.id },
    })
    expect(invitations.ok && invitations.value.kind === 'invitations'
      && invitations.value.invitations).toEqual([expect.objectContaining({ state: 'revoked' })])
    expect(JSON.stringify(invitations)).not.toContain(issued.value.result.invitationSecret)

    const audit = await admin.space.read(admin.session.identity, {
      kind: 'audit', space: { kind: 'id', spaceId: created.id },
    })
    expect(audit.ok && audit.value.kind === 'audit'
      && audit.value.entries.map((entry) => entry.action)).toEqual([
        'invitation-revoked', 'invitation-issued', 'space-created',
      ])

    const fresh = await admin.space.change(admin.session.identity, {
      requestId: 'audit-member-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
    })
    if (!fresh.ok || fresh.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    const member = await signIn('member')
    const accepted = await member.space.change(member.session.identity, {
      requestId: 'audit-member-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: fresh.value.result.invitationSecret },
    })
    if (!accepted.ok || accepted.value.session.kind !== 'replace') throw new Error('Invitation was not accepted')
    const resolved = await member.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: accepted.value.session.sessionSecret },
    })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Session did not resolve')
    expect(await member.space.read(resolved.value.identity, {
      kind: 'invitations', space: { kind: 'id', spaceId: created.id },
    })).toEqual({ ok: false, fault: { kind: 'forbidden' } })
    expect(await member.space.read(resolved.value.identity, {
      kind: 'audit', space: { kind: 'id', spaceId: created.id },
    })).toEqual({ ok: false, fault: { kind: 'forbidden' } })
  })

  it('pages Members with an opaque Space-scoped cursor', async () => {
    const admin = await signIn('admin')
    const created = await createSpace(admin)
    for (const subject of ['member-one', 'member-two']) {
      const issued = await admin.space.change(admin.session.identity, {
        requestId: `page-invitation-${subject}` as RequestId,
        command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
      })
      if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
      const recipient = await signIn(subject)
      const accepted = await recipient.space.change(recipient.session.identity, {
        requestId: `page-acceptance-${subject}` as RequestId,
        command: { kind: 'accept-invitation', invitationSecret: issued.value.result.invitationSecret },
      })
      if (!accepted.ok) throw new Error('Invitation was not accepted')
    }

    const first = await admin.space.read(admin.session.identity, {
      kind: 'members', space: { kind: 'id', spaceId: created.id }, page: { size: 2 },
    })
    if (!first.ok || first.value.kind !== 'members' || !first.value.next) throw new Error('First Member page was incomplete')
    expect(first.value.members).toHaveLength(2)
    const second = await admin.space.read(admin.session.identity, {
      kind: 'members', space: { kind: 'id', spaceId: created.id }, page: { size: 2, after: first.value.next },
    })
    expect(second.ok && second.value.kind === 'members' && second.value.members).toHaveLength(1)
  })

  it('publishes access revisions after membership and lifecycle transactions commit', async () => {
    const observed: Array<{ spaceId: string; reason: string; accessRevision: number }> = []
    const accessInvalidation = {
      publish: async (event: { spaceId: string; accessRevision: number; reason: string }) => {
        observed.push(event)
      },
    }
    const admin = await signIn('admin', accessInvalidation)
    const created = await createSpace(admin)
    const issued = await admin.space.change(admin.session.identity, {
      requestId: 'invalidation-invitation' as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'id', spaceId: created.id } },
    })
    if (!issued.ok || issued.value.result.kind !== 'invitation-issued') throw new Error('Invitation was not issued')
    const recipient = await signIn('member', accessInvalidation)
    const accepted = await recipient.space.change(recipient.session.identity, {
      requestId: 'invalidation-acceptance' as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: issued.value.result.invitationSecret },
    })
    if (!accepted.ok) throw new Error('Invitation was not accepted')
    const archived = await admin.space.change(admin.session.identity, {
      requestId: 'invalidation-archive' as RequestId,
      command: { kind: 'archive-space', space: { spaceId: created.id, expectedRevision: created.revision } },
    })
    if (!archived.ok) throw new Error('Space was not archived')

    expect(observed).toEqual([
      { spaceId: created.id, reason: 'membership-changed', accessRevision: 2 },
      { spaceId: created.id, reason: 'space-lifecycle-changed', accessRevision: 3 },
    ])
  })

  it('continues invitation and audit management pages through independent HTTP cursors', async () => {
    const adminServer = await startServer('admin')
    try {
      const admin = await httpSignIn(adminServer.origin)
      const created = await fetch(`${adminServer.origin}/api/spaces`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({
          requestId: 'http-paging-space', displayName: 'Delivery', key: 'DIG', timeZone: 'Europe/Oslo',
        }),
      })
      expect(created.status).toBe(201)
      for (let index = 0; index < 51; index += 1) {
        const issued = await fetch(`${adminServer.origin}/api/spaces/DIG/invitations`, {
          method: 'POST',
          headers: {
            cookie: admin.cookie, origin: adminServer.origin,
            'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
          },
          body: JSON.stringify({ requestId: `http-paging-invitation-${index}` }),
        })
        expect(issued.status).toBe(201)
      }

      type ManagementPage = {
        invitations: unknown[]
        audit: unknown[]
        next: { invitations?: string; audit?: string }
      }
      const firstResponse = await fetch(`${adminServer.origin}/api/spaces/DIG/management`, {
        headers: { cookie: admin.cookie },
      })
      const first = await firstResponse.json() as ManagementPage
      expect(first.invitations).toHaveLength(50)
      expect(first.audit).toHaveLength(50)
      expect(first.next).toMatchObject({
        invitations: expect.any(String),
        audit: expect.any(String),
      })

      const invitationResponse = await fetch(
        `${adminServer.origin}/api/spaces/DIG/management?invitationsAfter=${encodeURIComponent(first.next.invitations!)}`,
        { headers: { cookie: admin.cookie } },
      )
      const invitationPage = await invitationResponse.json() as ManagementPage
      expect(invitationPage.invitations).toHaveLength(1)

      const auditResponse = await fetch(
        `${adminServer.origin}/api/spaces/DIG/management?auditAfter=${encodeURIComponent(first.next.audit!)}`,
        { headers: { cookie: admin.cookie } },
      )
      const auditPage = await auditResponse.json() as ManagementPage
      expect(auditPage.audit).toHaveLength(2)
    } finally {
      await adminServer.close()
    }
  })

  it('issues and accepts an invitation through the HTTP Adapter', async () => {
    const adminServer = await startServer('admin')
    const memberServer = await startServer('member')
    try {
      const admin = await httpSignIn(adminServer.origin)
      const created = await fetch(`${adminServer.origin}/api/spaces`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({
          requestId: 'http-space', displayName: 'Delivery', key: 'DIG', timeZone: 'Europe/Oslo',
        }),
      })
      expect(created.status).toBe(201)
      const issued = await fetch(`${adminServer.origin}/api/spaces/DIG/invitations`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({ requestId: 'http-invitation' }),
      })
      expect(issued.status).toBe(201)
      const invitation = await issued.json() as { invitationPath: string }
      expect(invitation.invitationPath).toMatch(/^\/invitations\//)

      const member = await httpSignIn(memberServer.origin)
      const accepted = await fetch(`${memberServer.origin}/api${invitation.invitationPath}/accept`, {
        method: 'POST',
        headers: {
          cookie: member.cookie, origin: memberServer.origin,
          'content-type': 'application/json', 'x-csrf-token': member.csrfToken,
        },
        body: JSON.stringify({ requestId: 'http-acceptance' }),
      })
      expect(accepted.status).toBe(200)
      const replacementCookie = cookiePair(accepted.headers.get('set-cookie'), 'dig_session')
      const acceptance = await accepted.json() as { space: { key: string }; csrfToken: string }
      expect(acceptance.space.key).toBe('DIG')
      expect(acceptance.csrfToken).not.toBe(member.csrfToken)
      const board = await fetch(`${memberServer.origin}/api/spaces/DIG/board`, {
        headers: { cookie: replacementCookie },
      })
      expect(board.status).toBe(200)

      const management = await fetch(`${adminServer.origin}/api/spaces/DIG/management`, {
        headers: { cookie: admin.cookie },
      })
      expect(management.status).toBe(200)
      const view = await management.json() as { members: unknown[]; audit: unknown[] }
      expect(view.members).toHaveLength(2)
      expect(view.audit.length).toBeGreaterThanOrEqual(3)

      const left = await fetch(`${memberServer.origin}/api/spaces/DIG/management`, {
        method: 'POST',
        headers: {
          cookie: replacementCookie, origin: memberServer.origin,
          'content-type': 'application/json', 'x-csrf-token': acceptance.csrfToken,
        },
        body: JSON.stringify({ requestId: 'http-leave', action: 'leave-space' }),
      })
      expect(left.status).toBe(200)
      expect(await left.json()).toMatchObject({ result: { kind: 'member-left' }, signedOut: true })
      expect(left.headers.get('set-cookie')).toContain('dig_session=;')
    } finally {
      await Promise.all([adminServer.close(), memberServer.close()])
    }
  })

  it('changes a Member role and removes that Member through the HTTP Adapter', async () => {
    const adminServer = await startServer('admin')
    const memberServer = await startServer('member')
    try {
      const admin = await httpSignIn(adminServer.origin)
      await fetch(`${adminServer.origin}/api/spaces`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({
          requestId: 'http-role-space', displayName: 'Delivery', key: 'DIG', timeZone: 'Europe/Oslo',
        }),
      })
      const issued = await fetch(`${adminServer.origin}/api/spaces/DIG/invitations`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({ requestId: 'http-role-invitation' }),
      })
      const invitation = await issued.json() as { invitationPath: string }
      const member = await httpSignIn(memberServer.origin)
      await fetch(`${memberServer.origin}/api${invitation.invitationPath}/accept`, {
        method: 'POST',
        headers: {
          cookie: member.cookie, origin: memberServer.origin,
          'content-type': 'application/json', 'x-csrf-token': member.csrfToken,
        },
        body: JSON.stringify({ requestId: 'http-role-acceptance' }),
      })
      const management = await fetch(`${adminServer.origin}/api/spaces/DIG/management`, {
        headers: { cookie: admin.cookie },
      })
      const view = await management.json() as {
        members: Array<{ id: string; displayName: string; revision: number; role: string }>
      }
      const teammate = view.members.find((candidate) => candidate.displayName === 'Mira Member')!

      const promoted = await fetch(`${adminServer.origin}/api/spaces/DIG/management`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({
          requestId: 'http-role-promotion', action: 'set-member-role',
          memberId: teammate.id, expectedRevision: teammate.revision, role: 'space-administrator',
        }),
      })

      expect(promoted.status).toBe(200)
      const result = await promoted.json() as { result: { kind: string; member: { role: string; revision: number } } }
      expect(result.result).toMatchObject({
        kind: 'member-role-changed', member: { role: 'space-administrator', revision: 2 },
      })
      const removed = await fetch(`${adminServer.origin}/api/spaces/DIG/management`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({
          requestId: 'http-member-removal', action: 'remove-member',
          memberId: teammate.id, expectedRevision: result.result.member.revision,
        }),
      })
      expect(removed.status).toBe(200)
      expect(await removed.json()).toMatchObject({ result: { kind: 'member-removed', memberId: teammate.id } })
    } finally {
      await Promise.all([adminServer.close(), memberServer.close()])
    }
  })

  it('manages invitation and Space lifecycle through the HTTP Adapter', async () => {
    const adminServer = await startServer('admin')
    try {
      const admin = await httpSignIn(adminServer.origin)
      const created = await fetch(`${adminServer.origin}/api/spaces`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({
          requestId: 'http-lifecycle-space', displayName: 'Delivery', key: 'DIG', timeZone: 'Europe/Oslo',
        }),
      })
      let current = await created.json() as { revision: number; lifecycle: string }
      const issued = await fetch(`${adminServer.origin}/api/spaces/DIG/invitations`, {
        method: 'POST',
        headers: {
          cookie: admin.cookie, origin: adminServer.origin,
          'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
        },
        body: JSON.stringify({ requestId: 'http-lifecycle-invitation' }),
      })
      const invitation = await issued.json() as { invitation: { id: string } }

      const manage = async (requestId: string, action: string, input: Record<string, unknown> = {}) => {
        const response = await fetch(`${adminServer.origin}/api/spaces/DIG/management`, {
          method: 'POST',
          headers: {
            cookie: admin.cookie, origin: adminServer.origin,
            'content-type': 'application/json', 'x-csrf-token': admin.csrfToken,
          },
          body: JSON.stringify({ requestId, action, ...input }),
        })
        expect(response.status).toBe(200)
        return await response.json() as { result: { kind: string; space?: typeof current } }
      }

      expect((await manage('http-revoke', 'revoke-invitation', { invitationId: invitation.invitation.id })).result.kind)
        .toBe('invitation-revoked')
      const revised = await manage('http-revise', 'revise-space', {
        expectedRevision: current.revision, displayName: 'Delivery Flow', timeZone: 'America/Toronto',
      })
      expect(revised.result).toMatchObject({ kind: 'space-revised', space: { revision: 2 } })
      current = revised.result.space!
      const archived = await manage('http-archive', 'archive-space', { expectedRevision: current.revision })
      expect(archived.result).toMatchObject({ kind: 'space-archived', space: { lifecycle: 'archived' } })
      current = archived.result.space!
      const normalSwitcher = await fetch(`${adminServer.origin}/api/spaces`, { headers: { cookie: admin.cookie } })
      expect(await normalSwitcher.json()).toMatchObject({ spaces: [] })
      const archivedSwitcher = await fetch(`${adminServer.origin}/api/spaces?include=archived`, {
        headers: { cookie: admin.cookie },
      })
      expect(await archivedSwitcher.json()).toMatchObject({ spaces: [{ key: 'DIG', lifecycle: 'archived' }] })
      const restored = await manage('http-restore', 'restore-space', { expectedRevision: current.revision })
      expect(restored.result).toMatchObject({ kind: 'space-restored', space: { lifecycle: 'active' } })
      current = restored.result.space!
      const rearchived = await manage('http-rearchive', 'archive-space', { expectedRevision: current.revision })
      current = rearchived.result.space!
      const scheduled = await manage('http-schedule', 'schedule-space-deletion', { expectedRevision: current.revision })
      expect(scheduled.result).toMatchObject({
        kind: 'space-deletion-scheduled',
        space: { lifecycle: 'deletion_scheduled', deletionScheduledFor: '2026-09-11T08:00:00.000Z' },
      })
      current = scheduled.result.space!
      const cancelled = await manage('http-cancel', 'cancel-space-deletion', { expectedRevision: current.revision })
      expect(cancelled.result).toMatchObject({ kind: 'space-deletion-cancelled', space: { lifecycle: 'archived' } })
    } finally {
      await adminServer.close()
    }
  })

  async function startServer(subject: string) {
    const allowedOrigins = new Set<string>()
    const oidc = new MockOidcAdapter({
      issuer: 'https://identity.example.test', subject,
      displayName: subject === 'admin' ? 'Ada Admin' : 'Mira Member', email: `${subject}@example.test`,
    })
    const identity = new IdentityModuleImplementation(db, oidc, {
      redirectUri: 'http://127.0.0.1/api/auth/callback',
      allowedOrigins,
      installationAdministrators: new Set([identityKey('admin')]),
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
      now: () => now,
    })
    const space = new SpaceModuleImplementation(db, {
      invitationHmacSecret: 'test-invitation-hmac-secret-with-32-bytes',
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
      now: () => now,
    })
    const config: AppConfig = {
      host: '127.0.0.1', port: 0, databaseUrl, allowedOrigins, staticDir: null,
      secureCookies: false,
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
      installationAdministrators: new Set([identityKey('admin')]),
      oidc: null,
    }
    const server = createTeamServer({ identity, space, board: new BoardModuleImplementation(db) }, config)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    allowedOrigins.add(origin)
    return {
      origin,
      close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    }
  }

  async function httpSignIn(serverOrigin: string) {
    const begun = await fetch(`${serverOrigin}/api/auth/sign-in`, {
      method: 'POST', headers: { origin: serverOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: '/' }),
    })
    const authorization = new URL((await begun.json() as { authorizationUrl: string }).authorizationUrl)
    const attemptCookie = cookiePair(begun.headers.get('set-cookie'), 'dig_oidc_attempt')
    const callback = await fetch(
      `${serverOrigin}/api/auth/callback?code=accepted-code&state=${encodeURIComponent(authorization.searchParams.get('state') ?? '')}`,
      { headers: { cookie: attemptCookie }, redirect: 'manual' },
    )
    const cookie = cookiePair(callback.headers.get('set-cookie'), 'dig_session')
    const session = await fetch(`${serverOrigin}/api/session`, { headers: { cookie } })
    const body = await session.json() as { csrfToken: string }
    return { cookie, csrfToken: body.csrfToken }
  }
})

function neverReached(): never {
  throw new Error('Unexpected Space result')
}

function cookiePair(header: string | null, name: string): string {
  const match = header?.match(new RegExp(`(?:^|, )${name}=([^;]*)`))
  if (!match) throw new Error(`Missing ${name} cookie`)
  return `${name}=${match[1]}`
}
