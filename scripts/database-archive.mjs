#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createReadStream,createWriteStream } from 'node:fs'
import { open,unlink,stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function connection(value) {
  if (!value) throw new Error('Set the database URL explicitly')
  const url = new URL(value)
  if (!['postgres:','postgresql:'].includes(url.protocol)) throw new Error('Use a PostgreSQL URL')
  return { ...process.env,PGHOST: url.hostname,PGPORT: process.env.PG_TOOLS_CONTAINER ? process.env.PG_TOOLS_PORT || '5432' : url.port || '5432',PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),PGPASSWORD: decodeURIComponent(url.password),PGSSLMODE: url.searchParams.get('sslmode') || 'prefer' }
}
async function pg(tool,args,url,{ input,output } = {}) {
  const env = connection(url)
  const container = process.env.PG_TOOLS_CONTAINER
  const executable = container ? process.env.CONTAINER_ENGINE || 'docker' : tool
  const command = container ? ['exec','-i',...['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE'].flatMap(key => ['--env',key]),container,tool,...args] : args
  const child = spawn(executable,command,{ env,stdio: ['pipe','pipe','pipe'] })
  // Tool errors can contain connection details. Report a safe operation and code.
  child.stderr.resume()
  let text = ''
  const finished = new Promise((resolve,reject) => { child.once('error',() => reject(new Error(`${tool} could not start`)));child.once('close',code => code === 0 ? resolve() : reject(new Error(`${tool} failed with exit code ${code}`))) })
  const pipes = []
  if (input) pipes.push(pipeline(createReadStream(input),child.stdin).catch(error => {
    // Listing a custom archive reads only its table of contents and can close
    // stdin before the remaining data arrives. Still require a successful exit.
    if (tool === 'pg_restore' && args.includes('--list') && error.code === 'EPIPE') return
    throw new Error(`${tool} input failed`)
  }));else child.stdin.end()
  if (output) pipes.push(pipeline(child.stdout,createWriteStream(output,{ flags: 'w',mode: 0o600 })))
  else child.stdout.on('data',chunk => { if (text.length < 4096) text += chunk })
  await Promise.all([finished,...pipes])
  return text.trim()
}
export async function backup(filename,url) {
  // Exclusive creation prevents accidental overwrite of an earlier backup.
  const file = await open(filename,'wx',0o600);await file.close()
  try { await pg('pg_dump',['--format=custom','--no-owner','--no-acl'],url,{ output: filename });await pg('pg_restore',['--list'],url,{ input: filename }) }
  catch (error) { await unlink(filename).catch(() => undefined);throw error }
  return { bytes: (await stat(filename)).size }
}
export async function restore(filename,url) {
  const count = await pg('psql',['-X','-v','ON_ERROR_STOP=1','-Atc',"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S','f')"],url)
  if (count !== '0') throw new Error('Restore requires an empty destination database; existing data was preserved')
  await pg('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname',connection(url).PGDATABASE],url,{ input: filename })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action,filename] = process.argv.slice(2)
  try {
    if (!filename || !['backup','restore'].includes(action)) throw new Error('Usage: database-archive.mjs backup|restore FILE')
    const started = performance.now()
    const result = action === 'backup' ? await backup(filename,process.env.DATABASE_URL) : await restore(filename,process.env.RESTORE_DATABASE_URL)
    console.info(JSON.stringify({ event: `database-${action}-completed`,durationMs: Math.round(performance.now()-started),...result }))
  } catch (error) { console.error(JSON.stringify({ event: 'database-archive-failed',message: error.message }));process.exitCode=1 }
}
