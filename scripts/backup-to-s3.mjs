#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp,readFile,writeFile,rename,rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backup } from './database-archive.mjs'

const { S3_BUCKET,S3_ENDPOINT,BACKUP_STATE_FILE,DATABASE_URL } = process.env
let directory
async function upload(file,key) {
  const args = [...(S3_ENDPOINT ? ['--endpoint-url',S3_ENDPOINT] : []),'s3','cp',file,`s3://${S3_BUCKET}/dig/${key}`,'--only-show-errors']
  await new Promise((resolve,reject) => {
    const child = spawn('aws',args,{ stdio: ['ignore','ignore','pipe'] });child.stderr.resume()
    child.once('error',() => reject(new Error('S3 upload could not start')))
    child.once('close',code => code === 0 ? resolve() : reject(new Error('S3 upload failed')))
  })
}
try {
  if (!S3_BUCKET || !/^[a-z0-9][a-z0-9.-]+$/.test(S3_BUCKET) || !BACKUP_STATE_FILE || !DATABASE_URL) throw new Error('Set S3_BUCKET, BACKUP_STATE_FILE, and DATABASE_URL')
  if (S3_ENDPOINT && new URL(S3_ENDPOINT).protocol !== 'https:') throw new Error('S3_ENDPOINT must use HTTPS')
  let previous = {}
  try { previous = JSON.parse(await readFile(BACKUP_STATE_FILE,'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Backup state could not be read') }
  directory = await mkdtemp(join(tmpdir(),'dig-backup-'))
  const now = new Date(),name = now.toISOString().replaceAll(':','-')+'.dump',file = join(directory,name)
  const month = now.toISOString().slice(0,7)
  const result = await backup(file,DATABASE_URL)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const checksum = hash.digest('hex')
  await writeFile(file+'.sha256',`${checksum}  ${name}\n`,{ mode: 0o600 })
  for (const prefix of previous.monthlyPeriod !== month ? ['daily','monthly'] : ['daily']) {
    await upload(file,`${prefix}/${name}`);await upload(file+'.sha256',`${prefix}/${name}.sha256`)
  }
  await writeFile(BACKUP_STATE_FILE+'.tmp',JSON.stringify({ completedAt: new Date().toISOString(),monthlyPeriod: month,checksum,...result })+'\n',{ mode: 0o600 })
  await rename(BACKUP_STATE_FILE+'.tmp',BACKUP_STATE_FILE)
  console.info(JSON.stringify({ event: 'offsite-backup-completed',...result }))
} catch (error) { console.error(JSON.stringify({ event: 'offsite-backup-failed',message: error.message }));process.exitCode=1 }
finally { if (directory) await rm(directory,{ recursive: true,force: true }) }
