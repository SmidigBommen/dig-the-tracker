#!/usr/bin/env node
import { readFile,statfs } from 'node:fs/promises'
const checks = {}
const base = process.env.DIG_PUBLIC_URL
if (!base || !base.startsWith('https://') || !process.env.BACKUP_STATE_FILE || !process.env.DIG_DATA_PATH) {
  console.error('Set DIG_PUBLIC_URL=https://..., BACKUP_STATE_FILE, and DIG_DATA_PATH');process.exit(1)
}
for (const [name,path] of [['https','/'],['readiness','/health/ready']]) {
  try { const result = await fetch(new URL(path,base),{ signal: AbortSignal.timeout(8000),redirect: 'error' });checks[name] = result.ok;await result.body?.cancel() }
  catch { checks[name] = false }
}
try { const data = await statfs(process.env.DIG_DATA_PATH);checks.disk = data.bavail/data.blocks >= 0.10 } catch { checks.disk = false }
try { const state = JSON.parse(await readFile(process.env.BACKUP_STATE_FILE,'utf8'));const age = Date.now()-Date.parse(state.completedAt);checks.backup = Number.isFinite(age) && age >= 0 && age <= 24*60*60*1000 } catch { checks.backup = false }
console.info(JSON.stringify({ event: 'operations-check',checks }))
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1
