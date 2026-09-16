import { afterEach, expect, it, vi } from 'vitest'
import { AppearanceConflict, AppearanceSession, type AppearanceTransport } from './appearance-session.ts'
import type { AppearanceView } from '../../api/contracts/appearance.ts'

afterEach(() => { vi.unstubAllGlobals() })

it('applies choices immediately, preserves the newest selection, and retries a failed save', async () => {
  const values = new Map<string,string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,value: string) => values.set(key,value) })
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  let fail = false
  let release!: () => void
  let pause = true
  let saved: AppearanceView = { identityId: 'ada',palette: 'nature',mode: 'system',revision: 0 }
  const port: AppearanceTransport = {
    read: async () => saved,
    save: async (preference, revision) => {
      if (pause) { pause=false;await new Promise<void>(resolve => { release=resolve }) }
      if (fail) throw new Error('Offline')
      saved = { ...saved,...preference,revision: revision+1 }
      return saved
    },
  }
  const session = new AppearanceSession(port)
  session.connect('ada','csrf')
  await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true))
  session.choose({ palette: 'tokyo-night',mode: 'dark' })
  expect(document.documentElement.dataset.palette).toBe('tokyo-night')
  session.choose({ palette: 'neutral',mode: 'light' })
  expect(document.documentElement.dataset.scheme).toBe('light')
  release()
  await vi.waitFor(() => expect(session.getSnapshot().saving).toBe(false))
  expect(saved).toMatchObject({ palette: 'neutral',mode: 'light' })
  fail=true
  session.choose({ palette: 'nature',mode: 'system' })
  await vi.waitFor(() => expect(session.getSnapshot().error).toBeTruthy())
  expect(document.documentElement.dataset.scheme).toBe('dark')
  fail=false
  session.retry()
  await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ saving: false,error: undefined }))
  expect(saved).toMatchObject({ palette: 'nature',mode: 'system' })
  session.stop()
})

it('follows system changes while keeping an explicit mode fixed', async () => {
  let changed!: () => void
  const media = { matches: false,addEventListener: (_: string,listener: () => void) => { changed=listener },removeEventListener() {} }
  vi.stubGlobal('matchMedia',() => media)
  const session = new AppearanceSession({ read: async () => ({ identityId: 'ada',palette: 'tokyo-night',mode: 'system',revision: 0 }),
    save: async preference => ({ identityId: 'ada',...preference,revision: 1 }) })
  session.connect('ada','csrf')
  try {
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true))
    expect(document.documentElement.dataset.scheme).toBe('light')
    media.matches=true;changed()
    expect(document.documentElement.dataset.scheme).toBe('dark')
    session.choose({ palette: 'tokyo-night',mode: 'light' })
    changed()
    expect(document.documentElement.dataset.scheme).toBe('light')
    await vi.waitFor(() => expect(session.getSnapshot().saving).toBe(false))
  } finally { session.stop() }
})

it('ignores another account and an old account response while restoring the signed-in preference', async () => {
  const values = new Map([['dig:appearance:last',JSON.stringify({ palette: 'tokyo-night',mode: 'dark' })]])
  vi.stubGlobal('localStorage',{ getItem: (key: string) => values.get(key) ?? null,setItem: (key: string,value: string) => values.set(key,value) })
  const reads: Array<(view: AppearanceView) => void> = []
  const session = new AppearanceSession({ read: () => new Promise(resolve => reads.push(resolve)),save: async () => { throw new Error('Loading must never save cached settings') } })
  session.connect('ada','csrf-a')
  session.connect('mira','csrf-b')
  reads[1]({ identityId: 'mira',palette: 'neutral',mode: 'light',revision: 4 })
  await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true))
  reads[0]({ identityId: 'ada',palette: 'nature',mode: 'dark',revision: 8 })
  await Promise.resolve()
  window.dispatchEvent(new StorageEvent('storage',{ key: 'dig:appearance:account:ada',newValue: JSON.stringify({ order: Date.now(),operation: 'a',saving: false,view: { identityId: 'ada',palette: 'nature',mode: 'dark',revision: 9 } }) }))
  expect(session.getSnapshot()).toMatchObject({ palette: 'neutral',mode: 'light' })
  expect(document.documentElement.dataset.scheme).toBe('light')
  session.stop()
})

it('updates a same-account tab without taking focus or accepting an older revision', async () => {
  const session = new AppearanceSession({ read: async () => ({ identityId: 'ada',palette: 'nature',mode: 'system',revision: 2 }),
    save: async () => { throw new Error('Receiving another tab must not save again') } })
  session.connect('ada','csrf')
  await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true))
  const draft = document.createElement('textarea');document.body.append(draft);draft.value='Keep this draft';draft.focus()
  try {
    const receive = (revision: number, palette: string) => window.dispatchEvent(new StorageEvent('storage',{
      key: 'dig:appearance:account:ada',newValue: JSON.stringify({ order: Date.now(),operation: `change-${revision}`,saving: false,view: { identityId: 'ada',palette,mode: 'dark',revision } }),
    }))
    receive(3,'tokyo-night')
    expect(document.documentElement.dataset.palette).toBe('tokyo-night')
    receive(2,'neutral')
    expect(document.documentElement.dataset.palette).toBe('tokyo-night')
    expect(document.activeElement).toBe(draft)
    expect(draft.value).toBe('Keep this draft')
  } finally { session.stop();draft.remove() }
})

it.each([false,true])('resolves simultaneous tab choices when the superseding save fails offline=%s', async offline => {
  const receivers: Array<(event: StorageEvent) => void> = []
  const events: StorageEvent[] = []
  const listen = vi.spyOn(window,'addEventListener').mockImplementation((type,listener) => {
    if (type === 'storage') receivers.push(listener as (event: StorageEvent) => void)
  })
  vi.stubGlobal('localStorage',{ getItem: () => null,setItem: (key: string,value: string) => {
    if (key === 'dig:appearance:account:ada') events.push(new StorageEvent('storage',{ key,newValue: value }))
  } })
  let saved: AppearanceView = { identityId: 'ada',palette: 'nature',mode: 'system',revision: 0 }
  const requests: Array<() => void> = []
  const port: AppearanceTransport = { read: async () => saved,save: (preference,revision) => new Promise((resolve,reject) => {
    requests.push(() => {
      if (revision !== saved.revision) { reject(offline ? new Error('Offline') : new AppearanceConflict(saved));return }
      saved={ ...saved,...preference,revision: revision+1 };resolve(saved)
    })
  }) }
  const a = new AppearanceSession(port), b = new AppearanceSession(port)
  a.connect('ada','csrf');b.connect('ada','csrf')
  try {
    await vi.waitFor(() => expect(a.getSnapshot().ready && b.getSnapshot().ready).toBe(true))
    const time = vi.spyOn(Date,'now').mockReturnValueOnce(100).mockReturnValueOnce(101)
    a.choose({ palette: 'neutral',mode: 'light' })
    b.choose({ palette: 'tokyo-night',mode: 'dark' })
    time.mockRestore()
    const [fromA,fromB] = events.splice(0)
    receivers[0](fromB);receivers[1](fromA)
    requests.shift()!();requests.shift()!()
    await new Promise(resolve => setTimeout(resolve,0))
    for (const event of events.splice(0)) for (const receive of receivers) receive(event)
    expect(a.getSnapshot().saving).toBe(false)
    expect(b.getSnapshot().saving).toBe(false)
    expect(a.getSnapshot()).toMatchObject({ palette: b.getSnapshot().palette,mode: b.getSnapshot().mode })
    const owner = a.getSnapshot().error ? a : b
    if (owner.getSnapshot().error) {
      owner.retry();requests.shift()!()
      await vi.waitFor(() => expect(owner.getSnapshot().error).toBeUndefined())
      for (const event of events.splice(0)) for (const receive of receivers) receive(event)
    }
    expect(a.getSnapshot()).toMatchObject({ palette: saved.palette,mode: saved.mode,saving: false,error: undefined })
    expect(b.getSnapshot()).toMatchObject({ palette: saved.palette,mode: saved.mode,saving: false,error: undefined })
  } finally { a.stop();b.stop();listen.mockRestore() }
})
