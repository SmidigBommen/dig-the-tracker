#!/usr/bin/env node
import { mkdir,rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { backup,restore } from './database-archive.mjs'
import { createDatabase } from '../api-dist/db.js'
import { migrate } from '../api-dist/migrate.js'

const sourceUrl = process.env.DATABASE_URL
if (process.env.DIG_RECOVERY_TEST !== '1' || !sourceUrl || !['127.0.0.1','localhost'].includes(new URL(sourceUrl).hostname)) throw new Error('Set DIG_RECOVERY_TEST=1 and a disposable loopback DATABASE_URL')
const source = createDatabase(sourceUrl)
const name = `dig_restore_${randomUUID().replaceAll('-','')}`
const targetUrl = new URL(sourceUrl);targetUrl.pathname=`/${name}`
const target = createDatabase(targetUrl.toString())
const filename = `.test-artifacts/${name}.dump`
const quote = name => '"'+name.replaceAll('"','""')+'"'
async function fingerprint(db) {
  const tables = await db.query("select schemaname,tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by schemaname,tablename")
  const result = []
  for (const row of tables.rows) {
    const value = await db.query(`select count(*)::int as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as checksum from ${quote(row.schemaname)}.${quote(row.tablename)} t`)
    result.push({ table: row.schemaname+'.'+row.tablename,...value.rows[0] })
  }
  const sequences = await db.query("select schemaname,sequencename from pg_sequences where schemaname not in ('pg_catalog','information_schema') order by schemaname,sequencename")
  for (const row of sequences.rows) result.push({ sequence: row.schemaname+'.'+row.sequencename,...(await db.query(`select last_value,is_called from ${quote(row.schemaname)}.${quote(row.sequencename)}`)).rows[0] })
  return result
}
await mkdir('.test-artifacts',{ recursive: true })
await source.query(`create database ${name}`)
const started = performance.now()
try {
  const before = await fingerprint(source)
  const archived = await backup(filename,sourceUrl)
  await restore(filename,targetUrl.toString())
  await migrate(targetUrl.toString())
  const after = await fingerprint(target)
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Restored rows or sequences differ')
  let refused = false
  try { await restore(filename,targetUrl.toString()) } catch (error) { refused = error.message.includes('empty destination') }
  if (!refused) throw new Error('Restore did not protect the existing database')
  console.info(JSON.stringify({ event: 'recovery-drill-passed',tables: before.filter(value => value.table).length,rows: before.reduce((sum,value) => sum+(value.rows||0),0),bytes: archived.bytes,durationMs: Math.round(performance.now()-started) }))
} finally { await target.end();await source.query(`drop database ${name}`);await source.end();await rm(filename,{ force: true }) }
