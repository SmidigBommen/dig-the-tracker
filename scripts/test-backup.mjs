#!/usr/bin/env node
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

const url = process.env.DATABASE_URL
if (process.env.DIG_RECOVERY_TEST !== '1' || !url || !['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('Use a disposable loopback database with DIG_RECOVERY_TEST=1')
const directory = await mkdtemp(join(tmpdir(),'dig-backup-test-'))
const state = join(directory,'state.json'),calls = join(directory,'uploads.jsonl')
// Only the true-external AWS CLI is substituted. pg_dump and pg_restore use
// the real disposable database; the production script runs unchanged.
try {
  await mkdir(join(directory,'bin'))
  await writeFile(join(directory,'bin','aws'),`#!/usr/bin/env node
import { appendFile,copyFile } from 'node:fs/promises'
const args=process.argv.slice(2),index=args.indexOf('cp')
if(process.env.DIG_FAKE_UPLOAD_FAIL==='1')process.exit(1)
await copyFile(args[index+1],process.env.DIG_FAKE_UPLOAD_LOG+'.last-upload')
await appendFile(process.env.DIG_FAKE_UPLOAD_LOG,JSON.stringify(args[index+2])+'\\n')
`,{ mode: 0o700 })
  const initial = { completedAt: '2000-01-01T00:00:00.000Z',monthlyPeriod: '2000-01' }
  await writeFile(state,JSON.stringify(initial))
  async function run(fail) {
    return new Promise((resolve,reject) => {
      const child = spawn(process.execPath,['scripts/backup-to-s3.mjs'],{ env: { ...process.env,PATH: join(directory,'bin')+':'+process.env.PATH,
        S3_BUCKET: 'dig-backup-test',S3_ENDPOINT: 'https://storage.example.test',BACKUP_STATE_FILE: state,DIG_FAKE_UPLOAD_LOG: calls,DIG_FAKE_UPLOAD_FAIL: fail ? '1' : '0' },stdio: 'ignore' })
      child.once('error',reject);child.once('close',resolve)
    })
  }
  assert.equal(await run(true),1)
  assert.deepEqual(JSON.parse(await readFile(state,'utf8')),initial,'Failed upload must not advance backup freshness or monthly state')
  assert.equal(await run(false),0)
  const uploaded = (await readFile(calls,'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(uploaded.filter(key => key.includes('/daily/')).length,2)
  assert.equal(uploaded.filter(key => key.includes('/monthly/')).length,2,'A later successful run must catch up the monthly archive')
  const saved = JSON.parse(await readFile(state,'utf8'))
  assert.equal(saved.monthlyPeriod,new Date().toISOString().slice(0,7))
  assert.ok(Date.now()-Date.parse(saved.completedAt)<30_000)
  assert.equal(await run(false),0)
  const again = (await readFile(calls,'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(again.filter(key => key.includes('/monthly/')).length,2,'Keep one monthly copy per successful month')
  assert.equal(again.filter(key => key.includes('/daily/')).length,4)
  console.info(JSON.stringify({ event: 'backup-upload-contract-passed' }))
} finally { await rm(directory,{ recursive: true,force: true }) }
