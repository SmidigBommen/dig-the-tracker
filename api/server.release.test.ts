// @vitest-environment node
import { expect,it,vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createTeamServer } from './server.js'
import { loadConfig } from './config.js'

it('drains safely and logs request identifiers without request content or exception secrets', async () => {
  const lines: string[] = []
  const logged = vi.spyOn(console,'info').mockImplementation((value: string) => { lines.push(value) })
  const shutdown = new AbortController()
  const unexpected = async () => { throw new Error('private-database-password') }
  const server = createTeamServer({ agents: { work: unexpected,manage: unexpected,authenticate: unexpected,read: unexpected },exports: { read: unexpected },identity: { signIn: unexpected,session: unexpected,appearance: unexpected },
    space: { read: unexpected,change: unexpected,authorize: unexpected },board: { read: unexpected,change: unexpected,follow: unexpected } },
    loadConfig({ ALLOWED_ORIGINS: 'https://dig.example.test' }),async () => true,shutdown.signal)
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const failed = await fetch(`${url}/api/session?secret=do-not-log`,{ headers: { cookie: 'dig_session=secret-cookie','x-request-id': 'untrusted-request-id' } })
    expect(failed.status).toBe(500)
    expect(failed.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/)
    shutdown.abort()
    expect((await fetch(`${url}/health/ready`)).status).toBe(503)
    expect((await fetch(`${url}/health/live`)).status).toBe(200)
    const change = await fetch(`${url}/api/auth/sign-in`,{ method: 'POST',headers: { origin: 'https://dig.example.test' },body: '{}' })
    expect(change.status).toBe(503)
    expect(change.headers.get('retry-after')).toBe('5')
    const text = lines.join('\n')
    expect(text).toContain('http-request')
    for (const secret of ['private-database-password','do-not-log','secret-cookie','untrusted-request-id']) expect(text).not.toContain(secret)
    expect(lines.map(line => JSON.parse(line)).some(line => line.requestId === failed.headers.get('x-request-id') && line.status === 500)).toBe(true)
  } finally { logged.mockRestore();server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('bounds authentication bursts and does not trust spoofed forwarding headers', async () => {
  const logged = vi.spyOn(console,'info').mockImplementation(() => undefined)
  const failed = async () => ({ ok: false as const,fault: { kind: 'not-authenticated' as const } })
  const server = createTeamServer({ agents: { work: failed,manage: failed,authenticate: failed,read: failed },exports: { read: failed },identity: { signIn: failed,session: failed,appearance: failed },
    space: { read: failed,change: failed,authorize: failed },board: { read: failed,change: failed,follow: failed } },loadConfig({ ALLOWED_ORIGINS: 'https://dig.example.test' }))
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    for (let i=0;i<120;i++) expect((await fetch(`${url}/api/auth/sign-in`,{ method: 'POST',headers: { origin: 'https://dig.example.test','x-forwarded-for': `192.0.2.${i}` },body: '{}' })).status).toBe(401)
    const limited = await fetch(`${url}/api/auth/sign-in`,{ method: 'POST',headers: { origin: 'https://dig.example.test','x-forwarded-for': '198.51.100.1' },body: '{}' })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await fetch(`${url}/health/live`)).status).toBe(200)
  } finally { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));logged.mockRestore() }
})

it('reserves MCP request slots while authentication is pending',async()=>{
  const unexpected=async()=>{throw Error('Unexpected application operation')}
  const pending:Array<()=>void>=[]
  const server=createTeamServer({
    agents:{work:unexpected,manage:unexpected,read:unexpected,authenticate:()=>new Promise(resolve=>pending.push(()=>resolve({ok:false,fault:{kind:'not-authenticated'}})))},
    exports:{read:unexpected},identity:{signIn:unexpected,session:unexpected,appearance:unexpected},
    space:{read:unexpected,change:unexpected,authorize:unexpected},board:{read:unexpected,change:unexpected,follow:unexpected},
  },loadConfig({ALLOWED_ORIGINS:'https://dig.example.test'}))
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
  const request=()=>fetch(url,{method:'POST',headers:{authorization:`Bearer dig_agent_${'a'.repeat(43)}`,'content-type':'application/json'},body:'{}'})
  const requests:Promise<Response>[]=[]
  try {
    for(let i=0;i<4;i++)requests.push(request())
    await vi.waitFor(()=>expect(pending).toHaveLength(4))
    const rejected=await request()
    expect(rejected.status).toBe(429)
    expect(rejected.headers.get('retry-after')).toBe('1')
    expect(pending).toHaveLength(4)
    for(const release of pending)release()
    expect((await Promise.all(requests)).every(response=>response.status===401)).toBe(true)
  } finally {for(const release of pending)release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
