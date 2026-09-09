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

run('Slice 8 browser through HTTP and PostgreSQL', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  afterAll(async () => { await db.end() })

  it('searches, opens Flow and reads workload through HTTP', async () => {
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
      const original = await (await fetch('/api/spaces/DIG/board')).json() as BoardOverview
      const added = await transport.change({ requestId: randomUUID() as RequestId,command: { kind: 'capture-task',input: {
        title: 'Investigate delivery latency',assigneeId: original.currentMemberId,tags: ['Operations'],
      } } })
      if (!added.ok || !added.value.result.taskId) throw new Error('Capture failed')
      await transport.change({ requestId: randomUUID() as RequestId,command: { kind: 'place-task',task: { taskId: added.value.result.taskId,expectedRevision: 1 as never },
        destination: { columnId: original.columns[1].id,expectedOrderRevision: original.columns[1].orderRevision,place: { kind: 'last' } },
      } })
      await transport.change({ requestId: randomUUID() as RequestId,command: { kind: 'capture-task',input: { title: 'Referenced work' } } })
      await space.change(resolved.value.identity,{ requestId: randomUUID() as RequestId,command: { kind: 'create-space',input: { key: 'OTHER',displayName: 'Other team',timeZone: 'UTC' } } })
      await new HttpBoardTransport('OTHER',browser.csrfToken).change({ requestId: randomUUID() as RequestId,command: { kind: 'capture-task',input: { title: 'Cross-Space target' } } })
      await transport.change({ requestId: randomUUID() as RequestId,command: { kind: 'revise-task',task: { taskId: added.value.result.taskId,expectedRevision: 2 as never },changes: { description: 'See DIG-2, OTHER-1 and MISSING-1.' } } })
      await transport.change({ requestId: randomUUID() as RequestId,command: { kind: 'add-comment',taskId: added.value.result.taskId,text: 'Related to DIG-2.',mentions: [] } })
      const overview = await (await fetch('/api/spaces/DIG/board')).json() as BoardOverview
      const user = userEvent.setup()
      const view = render(createElement(BoardWorkspace,{ initialBoard: overview,transport }))
      try {
        await user.click(screen.getByRole('tab',{ name: 'Search' }))
        await user.type(screen.getByRole('searchbox'),'Operations{Enter}')
        await screen.findByText('1 results for “Operations”')
        await user.click(screen.getByRole('button',{ name: /DIG-1/ }))
        await screen.findByRole('dialog',{ name: 'DIG-1' })
        const references = await screen.findAllByRole('link',{ name: /DIG-2/ })
        expect(references).toHaveLength(2)
        expect(screen.getByRole('link',{ name: 'OTHER-1' })).toHaveAttribute('href','/spaces/OTHER/tasks/OTHER-1')
        expect(screen.getByRole('link',{ name: 'OTHER-1' })).toHaveAttribute('target','_blank')
        expect(screen.queryByRole('link',{ name: /MISSING-1/ })).not.toBeInTheDocument()
        await user.click(references[0])
        await screen.findByRole('dialog',{ name: 'DIG-2' })
        await user.click(screen.getByRole('button',{ name: 'Close Task dialog' }))
        await user.click(screen.getByRole('tab',{ name: 'Flow' }))
        await screen.findByRole('heading',{ name: 'Weekly throughput' })
        expect(screen.getByRole('meter',{ name: 'In Progress: 1 Tasks, limit 3' })).toBeInTheDocument()
        expect(screen.getByRole('button',{ name: /DIG-1/ })).toBeInTheDocument()
        await user.click(screen.getByRole('tab',{ name: 'Workload' }))
        await screen.findByRole('region',{ name: 'Ada workload' })
        expect(screen.getByText('1 Active Tasks')).toBeInTheDocument()
        await user.click(screen.getByRole('tab',{ name: 'Board' }))
        await waitFor(() => expect(screen.getByRole('button',{ name: /DIG-1/ })).toHaveAttribute('draggable','true'))
      } finally { view.unmount() }
      const previousPath = window.location.pathname
      const storage = new Map<string,string>()
      vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string,value: string) => storage.set(key,value) })
      window.history.replaceState({},'', '/spaces/OTHER/tasks/OTHER-1')
      const TeamApp = (await import('../../src/team/TeamApp.tsx')).default
      const linked = render(createElement(TeamApp))
      try {
        await screen.findByRole('dialog',{ name: 'OTHER-1' })
        expect(await screen.findByDisplayValue('Cross-Space target')).toBeInTheDocument()
      } finally { linked.unmount();window.history.replaceState({},'',previousPath) }
    } finally {
      cleanup()
      vi.unstubAllGlobals()
      server.closeIdleConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }, 20000)
})
