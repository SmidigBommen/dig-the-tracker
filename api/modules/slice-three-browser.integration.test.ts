// @vitest-environment jsdom
import { createElement } from 'react'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

run('Slice 3 browser through HTTP and PostgreSQL', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  afterAll(async () => { await db.end() })

  it('captures by keyboard, reloads, and edits through the real BoardTransport', async () => {
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
      const overview = await (await fetch('/api/spaces/DIG/board')).json() as BoardOverview
      const transport = new HttpBoardTransport('DIG', browser.csrfToken)
      const user = userEvent.setup()
      const view = render(createElement(BoardWorkspace, { initialBoard: overview, transport }))
      screen.getByRole('button', { name: 'New Task' }).focus()
      await user.keyboard('{Enter}Browser work{Tab}First line{Enter}Second line')
      screen.getByRole('button', { name: 'Create Task' }).focus()
      await user.keyboard('{Enter}')
      expect(await screen.findByRole('heading', { name: 'DIG-1 · Browser work' })).toBeInTheDocument()
      expect(screen.getByText(/First line/)).toHaveTextContent('First line Second line')
      view.unmount()
      const reloaded = await (await fetch('/api/spaces/DIG/board')).json() as BoardOverview
      render(createElement(BoardWorkspace, { initialBoard: reloaded, transport: new HttpBoardTransport('DIG', browser.csrfToken) }))
      await user.click(screen.getByRole('button', { name: /DIG-1/ }))
      await user.click(await screen.findByRole('button', { name: 'Edit Task' }))
      await user.clear(screen.getByLabelText('Title'))
      await user.type(screen.getByLabelText('Title'), 'Revised in browser')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))
      expect(await screen.findByRole('heading', { name: 'DIG-1 · Revised in browser' })).toBeInTheDocument()
      const detail = await transport.read({ kind: 'task', task: { kind: 'key', taskKey: 'DIG-1' as never } })
      expect(detail).toMatchObject({ ok: true, value: { value: { title: 'Revised in browser', revision: 2, description: 'First line\nSecond line' } } })
    } finally {
      vi.unstubAllGlobals()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
