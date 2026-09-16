// @vitest-environment jsdom
import { createElement } from 'react'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDatabase, type Database } from '../db.js'
import { loadConfig } from '../config.js'
import { createTeamServer } from '../server.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import { SpaceModuleImplementation } from './space/space-module.js'
import { BoardModuleImplementation } from './board/board-module.js'
import type { AppearanceView } from '../contracts/appearance.js'
import type { RequestId } from './shared.js'
import { HttpBoardTransport } from '../../src/adapters/http/board-transport.ts'
import TeamApp from '../../src/team/TeamApp.tsx'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const origin = 'https://dig.example.test'
let db: Database

run('Slice 9 browser through HTTP and PostgreSQL', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  afterAll(async () => { await db.end() })

  it('persists theme choices, preserves open drafts, and restores preferences across Spaces and reloads', async () => {
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
    const storage = new Map<string,string>()
    vi.stubGlobal('localStorage',{ getItem: (key: string) => storage.get(key) ?? null,setItem: (key: string,value: string) => storage.set(key,value),removeItem: (key: string) => storage.delete(key) })
    vi.stubGlobal('matchMedia',() => ({ matches: false,addEventListener() {},removeEventListener() {} }))
    let feeds = 0
    // Supply only browser-owned URL resolution, cookie, and Origin behavior.
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      if (path.includes('/events')) feeds++
      const headers = new Headers(init?.headers)
      headers.set('origin', origin)
      headers.set('cookie', `dig_session=${browser.sessionSecret}`)
      return nativeFetch(new URL(path, base), { ...init, headers })
    })
    try {
      await new HttpBoardTransport('DIG',browser.csrfToken).change({ requestId: randomUUID() as RequestId,
        command: { kind: 'capture-task',input: { title: 'Keep this work open' } } })
      await space.change(resolved.value.identity,{ requestId: randomUUID() as RequestId,
        command: { kind: 'create-space',input: { key: 'OTHER',displayName: 'Other team',timeZone: 'UTC' } } })
      const user = userEvent.setup()
      const view = render(createElement(TeamApp))
      await screen.findByRole('button',{ name: 'New Task',exact: true })
      await user.click(screen.getByRole('button',{ name: 'Personal menu' }))
      await user.click(screen.getByRole('button',{ name: 'Appearance',exact: true }))
      await screen.findByText('Appearance saved')
      await user.click(screen.getByRole('radio',{ name: 'Tokyo Night' }))
      await user.click(screen.getByRole('radio',{ name: 'Dark',exact: true }))
      await waitFor(() => expect(screen.getByText('Appearance saved')).toBeInTheDocument())
      const saved = await (await fetch('/api/appearance')).json() as AppearanceView
      expect(saved).toMatchObject({ palette: 'tokyo-night',mode: 'dark' })
      expect(document.documentElement.dataset.scheme).toBe('dark')
      await user.click(screen.getByRole('button',{ name: 'Close Appearance dialog' }))
      await user.click(screen.getByRole('button',{ name: /DIG-1/ }))
      const comment = await screen.findByRole('textbox',{ name: 'Comment' })
      await user.type(comment,'An unfinished comment to preserve')
      const title = screen.getByRole('textbox',{ name: 'Title' })
      const feedCount = feeds
      // Another authenticated client saves; deliver the browser storage event to this open tab.
      const updated = await (await fetch('/api/appearance',{ method: 'POST',headers: { 'content-type': 'application/json','x-csrf-token': browser.csrfToken },
        body: JSON.stringify({ preference: { palette: 'neutral',mode: 'light' },expectedRevision: saved.revision }) })).json() as AppearanceView
      act(() => { window.dispatchEvent(new StorageEvent('storage',{ key: `dig:appearance:account:${updated.identityId}`,
        newValue: JSON.stringify({ order: Date.now(),operation: 'another-tab',view: updated,saving: false }) })) })
      expect(document.documentElement.dataset.palette).toBe('neutral')
      expect(document.documentElement.dataset.scheme).toBe('light')
      expect(comment).toHaveValue('An unfinished comment to preserve')
      expect(comment).toHaveFocus()
      expect(screen.getByRole('textbox',{ name: 'Title' })).toBe(title)
      expect(feeds).toBe(feedCount)
      view.unmount()
      render(createElement(TeamApp))
      await screen.findByRole('button',{ name: 'New Task',exact: true })
      await waitFor(() => expect(document.documentElement.dataset.palette).toBe('neutral'))
      expect(document.documentElement.dataset.scheme).toBe('light')
      await user.selectOptions(screen.getByLabelText('Space'),'OTHER')
      await screen.findByRole('heading',{ name: 'Other team',exact: true })
      expect(document.documentElement.dataset.palette).toBe('neutral')
    } finally {
      cleanup();vi.unstubAllGlobals()
      server.closeIdleConnections()
      await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()))
    }
  },20000)
})
