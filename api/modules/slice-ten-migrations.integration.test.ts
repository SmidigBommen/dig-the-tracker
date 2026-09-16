// @vitest-environment node
import { mkdtemp,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect,it } from 'vitest'
import { createDatabase } from '../db.js'
import { migrate } from '../migrate.js'

it.skipIf(process.env.DIG_DATABASE_TESTS !== '1')('serializes competing migration runners and rolls back a failed future migration', async () => {
  const root = createDatabase(process.env.DATABASE_URL!)
  const name = `dig_migration_${randomUUID().replaceAll('-','')}`
  const url = new URL(process.env.DATABASE_URL!);url.pathname=`/${name}`
  const directory = await mkdtemp(join(tmpdir(),'dig-release-migrations-'))
  await root.query(`create database ${name}`)
  const db = createDatabase(url.toString())
  try {
    const first = '-- migrate:up\ncreate table release_marker(value text); insert into release_marker values (\'preserved\');\n-- migrate:down\ndrop table release_marker;'
    await writeFile(join(directory,'001_first.sql'),first)
    await Promise.all([migrate(url.toString(),'up',directory),migrate(url.toString(),'up',directory)])
    expect((await db.query('select value from release_marker')).rows).toEqual([{ value: 'preserved' }])
    await writeFile(join(directory,'002_future.sql'),'-- migrate:up\nalter table release_marker add column added text; select nonexistent_function();\n-- migrate:down\nalter table release_marker drop column added;')
    await expect(migrate(url.toString(),'up',directory)).rejects.toThrow()
    expect((await db.query("select column_name from information_schema.columns where table_name='release_marker'")).rows).toEqual([{ column_name: 'value' }])
    await writeFile(join(directory,'002_future.sql'),'-- migrate:up\nalter table release_marker add column added text;\n-- migrate:down\nalter table release_marker drop column added;')
    await migrate(url.toString(),'up',directory)
    expect((await db.query('select value,added from release_marker')).rows).toEqual([{ value: 'preserved',added: null }])
    await writeFile(join(directory,'001_first.sql'),first+'\n-- changed')
    await expect(migrate(url.toString(),'up',directory)).rejects.toThrow('has changed')
  } finally { await db.end();await root.query(`drop database ${name}`);await root.end();await rm(directory,{ recursive: true,force: true }) }
})
