// @vitest-environment jsdom
import { createElement } from 'react'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
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

run('Slice 4 browser through HTTP and PostgreSQL', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  afterAll(async () => { await db.end() })

  it('moves a Task by keyboard through HTTP and persists its Column', async () => {
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
      const captured = await transport.change({ requestId: randomUUID() as RequestId,
        command: { kind: 'capture-task', input: { title: 'Move this work' } } })
      expect(captured.ok).toBe(true)
      const overview = await (await fetch('/api/spaces/DIG/board')).json() as BoardOverview
      const user = userEvent.setup()
      const select = async (label: string, value: string) => {
        const input = await screen.findByLabelText(label)
        await waitFor(() => expect(input).toBeEnabled())
        await user.selectOptions(input, value)
      }
      render(createElement(BoardWorkspace, { initialBoard: overview, transport }))
      await user.click(screen.getByRole('button', { name: /DIG-1/ }))
      await select('Move to Column', overview.columns[1].id)
      screen.getByRole('button', { name: 'Move Task' }).focus()
      await user.keyboard('{Enter}')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Move Task' })).toBeEnabled())
      await user.click(screen.getByRole('button', { name: 'Close Task dialog' }))
      expect(await within(screen.getByRole('region', { name: /In Progress/ })).findByRole('button', { name: /DIG-1/ })).toBeInTheDocument()
      const reloaded = await (await fetch('/api/spaces/DIG/board')).json() as BoardOverview
      expect(reloaded.columns[1].tasks.items).toMatchObject([{ title: 'Move this work' }])
      await user.click(screen.getByRole('button', { name: /DIG-1/ }))
      await select('Close as', 'rejected')
      await user.type(screen.getByLabelText('Closing comment'), 'Outside our scope')
      await user.click(screen.getByRole('button', { name: 'Close Task' }))
      await screen.findByText('Outcome: Rejected')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Show history' })).toBeEnabled())
      await user.click(screen.getByRole('button', { name: 'Show history' }))
      expect(await screen.findByText('Outside our scope')).toBeInTheDocument()
      await select('Outcome', 'cancelled')
      await user.click(screen.getByRole('button', { name: 'Change Outcome' }))
      await screen.findByText('Outcome: Cancelled')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Move Task' })).toBeEnabled())
      await select('Move to Column', overview.columns[0].id)
      await user.click(screen.getByRole('button', { name: 'Move Task' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Close Task' })).toBeEnabled())
      const reopened = await transport.read({ kind: 'task', task: { kind: 'key', taskKey: 'DIG-1' as never }, history: { size: 200 } })
      expect(reopened).toMatchObject({ ok: true, value: { value: { closedAt: null, outcome: null, history: { items: expect.arrayContaining([
        expect.objectContaining({ kind: 'closed', outcome: { kind: 'rejected' }, comment: 'Outside our scope' }),
        expect.objectContaining({ kind: 'outcome-changed', outcome: { kind: 'cancelled' } }),
        expect.objectContaining({ kind: 'reopened' }),
      ]) } } } })
    } finally {
      vi.unstubAllGlobals()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
