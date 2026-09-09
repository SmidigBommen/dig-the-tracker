// @vitest-environment jsdom
import { createElement } from 'react'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

run('Slice 7 browser through HTTP and PostgreSQL', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  afterAll(async () => { await db.end() })

  it('edits a workflow through HTTP and delivers it to a second open Board', async () => {
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
      const overview = await (await fetch('/api/spaces/DIG/board')).json() as BoardOverview
      const user = userEvent.setup()
      const view = render(createElement(BoardWorkspace, { initialBoard: overview, transport }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'New Task' })).toBeEnabled())
      // A second browser has its own BoardSession and HTTP connection.
      const other = new (await import('../../src/board-session/board-session.ts')).BoardSession(new HttpBoardTransport('DIG', browser.csrfToken), overview)
      other.startLive()
      try {
        await waitFor(() => expect(other.getSnapshot().connected).toBe(true))
        await user.click(screen.getByRole('button', { name: 'Workflow settings' }))
        await screen.findByRole('dialog', { name: 'Workflow' })
        await user.clear(screen.getByLabelText('Column name 1'))
        await user.type(screen.getByLabelText('Column name 1'), 'x'.repeat(61))
        await user.click(screen.getByRole('button', { name: 'Save workflow' }))
        await user.click(await screen.findByRole('button', { name: 'Reload current workflow' }))
        await waitFor(() => expect(screen.getByLabelText('Column name 1')).toHaveValue('Backlog'))
        await user.clear(screen.getByLabelText('Column name 1'))
        await user.type(screen.getByLabelText('Column name 1'), 'Ready')
        await user.click(screen.getByRole('button', { name: 'Add Column' }))
        expect(screen.getByLabelText('WIP limit 4')).toHaveValue(3)
        await user.type(screen.getByLabelText('Column name 4'), 'Review')
        await user.click(screen.getByRole('button', { name: 'Save workflow' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Workflow' })).not.toBeInTheDocument())
        expect(screen.getByRole('region', { name: /Ready/ })).toBeInTheDocument()
        await waitFor(() => expect(other.getSnapshot().overview.columns.map((column) => column.name)).toEqual(['Ready', 'In Progress', 'Done', 'Review']), { timeout: 4000 })
        await user.click(screen.getByRole('button', { name: 'Workflow settings' }))
        await screen.findByRole('dialog', { name: 'Workflow' })
        await user.click(screen.getByRole('button', { name: 'Archive Review' }))
        await user.click(screen.getByRole('button', { name: 'Save workflow' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Workflow' })).not.toBeInTheDocument())
        expect(screen.queryByRole('region', { name: /Review/ })).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Workflow settings' }))
        await screen.findByRole('dialog', { name: 'Workflow' })
        await user.click(screen.getByText('Archived Columns (1)'))
        await user.click(screen.getByRole('button', { name: 'Restore Column Review' }))
        await user.click(screen.getByRole('button', { name: 'Save workflow' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Workflow' })).not.toBeInTheDocument())
        expect(screen.getByRole('region', { name: /Review/ })).toBeInTheDocument()
        const reloaded = await transport.read({ kind: 'workflow' })
        expect(reloaded).toMatchObject({ ok: true, value: { kind: 'workflow', value: { revision: 4 } } })
      } finally { other.stopLive(); view.unmount() }
    } finally {
      cleanup()
      vi.unstubAllGlobals()
      server.closeIdleConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }, 20000)
})
