// @vitest-environment jsdom
import { createElement } from 'react'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDatabase, type Database } from '../db.js'
import { loadConfig } from '../config.js'
import { createTeamServer } from '../server.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import { SpaceModuleImplementation } from './space/space-module.js'
import { BoardModuleImplementation } from './board/board-module.js'
import type { BoardOverview } from '../contracts/board.js'
import type { RequestId } from './shared.js'
import { HttpBoardTransport } from '../../src/adapters/http/board-transport.ts'
import { BoardWorkspace } from '../../src/views/BoardWorkspace.tsx'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const origin = 'https://dig.example.test'
let db: Database

run('Slice 6 browser through HTTP and PostgreSQL', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  afterAll(async () => { await db.end() })

  it('receives another browser movement and comment, then recovers with its draft after a disconnect', async () => {
    await db.query('truncate team.identities, team.space_key_reservations cascade')
    const identity = new IdentityModuleImplementation(db, new MockOidcAdapter({
      issuer: 'https://identity.example.test', subject: 'admin', displayName: 'Ada',
    }), { redirectUri: `${origin}/api/auth/callback`, allowedOrigins: new Set([origin]),
      installationAdministrators: new Set(['https://identity.example.test|admin']),
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes' })
    const space = new SpaceModuleImplementation(db, { invitationHmacSecret: 'test-invitation-hmac-secret-with-32-bytes',
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes' })
    const board = new BoardModuleImplementation(db)
    const begun = await identity.signIn({ kind: 'begin', returnTo: '/' as never })
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in failed')
    const completed = await identity.signIn({ kind: 'complete', attemptSecret: begun.value.attemptSecret,
      callback: { code: 'accepted-code', state: new URL(begun.value.authorizationUrl).searchParams.get('state')! } })
    if (!completed.ok || completed.value.kind !== 'established') throw new Error('Sign-in failed')
    const browser = completed.value.session
    const resolved = await identity.session({ kind: 'resolve', use: 'read', evidence: { sessionSecret: browser.sessionSecret } })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Session failed')
    const created = await space.change(resolved.value.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'create-space', input: { key: 'DIG', displayName: 'Delivery', timeZone: 'UTC' } } })
    expect(created.ok).toBe(true)
    const server = createTeamServer({ identity, space, board }, loadConfig({ ALLOWED_ORIGINS: origin }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const nativeFetch = globalThis.fetch
    // Supply only browser-owned URL resolution, cookie, and Origin behavior.
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      headers.set('origin', origin)
      headers.set('cookie', `dig_session=${browser.sessionSecret}`)
      return nativeFetch(new URL(path, base), { ...init, headers })
    })
    try {
      const transport = new HttpBoardTransport('DIG', browser.csrfToken)
      const createdTask = await transport.change({ requestId: randomUUID() as RequestId,
        command: { kind: 'capture-task', input: { title: 'Discuss this work' } } })
      expect(createdTask.ok).toBe(true)
      const overview = await (await fetch('/api/spaces/DIG/board')).json() as BoardOverview
      const user = userEvent.setup()
      const view = render(createElement(BoardWorkspace, { initialBoard: overview, transport }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'New Task' })).toBeEnabled())
      // A second browser has its own BoardSession and HTTP connection.
      const other = new (await import('../../src/board-session/board-session.ts')).BoardSession(new HttpBoardTransport('DIG', browser.csrfToken), overview)
      other.startLive()
      try {
        await waitFor(() => expect(other.getSnapshot().connected).toBe(true))
        await act(async () => { await other.openEditor({ kind: 'key', taskKey: 'DIG-1' as never }) })
        const active = overview.columns.find((column) => column.flowRole === 'active')!
        await act(async () => { expect(await other.moveTask(other.getSnapshot().detail!, {
          columnId: active.id, expectedOrderRevision: active.orderRevision, place: { kind: 'last' },
        })).toBe(true) })
        await waitFor(() => expect(within(screen.getByRole('region', { name: /In Progress/ })).getByRole('button', { name: /DIG-1/ })).toBeInTheDocument(), { timeout: 4000 })
        await user.click(screen.getByRole('button', { name: /DIG-1/ }))
        await waitFor(() => expect(screen.getByLabelText('Comment')).toBeEnabled())
        await user.type(screen.getByLabelText('Comment'), 'My unposted draft')
        await act(async () => {
          other.updateCommentDraft({ text: 'Comment from the other browser' })
          expect(await other.saveComment()).toBe(true)
        })
        await screen.findByText('Comment from the other browser', {}, { timeout: 4000 })
        expect(screen.getByLabelText('Comment')).toHaveValue('My unposted draft')
        await act(async () => { window.dispatchEvent(new Event('offline')) })
        expect(screen.getByLabelText('Comment')).toBeDisabled()
        await act(async () => { window.dispatchEvent(new Event('online')) })
        await waitFor(() => expect(screen.getByLabelText('Comment')).toBeEnabled(), { timeout: 4000 })
        expect(screen.getByLabelText('Comment')).toHaveValue('My unposted draft')
      } finally { other.stopLive(); view.unmount() }
    } finally {
      cleanup()
      vi.unstubAllGlobals()
      server.closeIdleConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }, 20000)
})
