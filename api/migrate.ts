import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabase } from './db.js'

export interface Migration {
  version: string
  checksum: string
  up: string
  down: string
}

interface AppliedMigration {
  version: string
  checksum: string
}

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
  return Promise.all(files.map(async (file) => {
    const sql = await readFile(resolve(directory, file), 'utf8')
    const marker = /^-- migrate:down\s*$/m
    const match = marker.exec(sql)
    if (!match) throw new Error(`${file} is missing a -- migrate:down marker`)
    return {
      version: file.replace(/\.sql$/, ''),
      checksum: createHash('sha256').update(sql).digest('hex'),
      up: sql.slice(0, match.index).replace(/^-- migrate:up\s*$/m, '').trim(),
      down: sql.slice(match.index + match[0].length).trim(),
    }
  }))
}

export function validateAppliedMigrations(migrations: Migration[], rows: AppliedMigration[]) {
  const applied = new Map(rows.map((row) => [row.version, row.checksum]))
  const migrationVersions = migrations.map((migration) => migration.version)
  const appliedVersions = [...applied.keys()]

  for (const [version, checksum] of applied) {
    const migration = migrations.find((candidate) => candidate.version === version)
    if (!migration) throw new Error(`Applied migration ${version} is missing from disk`)
    if (migration.checksum !== checksum) throw new Error(`Applied migration ${version} has changed`)
  }
  if (appliedVersions.some((version, index) => version !== migrationVersions[index])) {
    throw new Error('Applied migrations are not an ordered prefix of the migrations on disk')
  }

  return applied
}

export async function migrate(databaseUrl: string, action: 'up' | 'reset' = 'up', directory = resolve('db/migrations')) {
  const migrations = await loadMigrations(directory)
  const db = createDatabase(databaseUrl)
  const client = await db.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [1_943_494_471])
    await client.query(`create table if not exists schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`)
    const appliedResult = await client.query<AppliedMigration>('select version, checksum from schema_migrations order by version')
    const applied = validateAppliedMigrations(migrations, appliedResult.rows)

    if (action === 'reset') {
      for (const migration of [...migrations].reverse()) {
        if (!applied.has(migration.version)) continue
        await client.query('begin')
        try {
          await client.query(migration.down)
          await client.query('delete from schema_migrations where version = $1', [migration.version])
          await client.query('commit')
          applied.delete(migration.version)
          console.log(`Rolled back ${migration.version}`)
        } catch (error) {
          await client.query('rollback')
          throw error
        }
      }
    }

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      await client.query('begin')
      try {
        await client.query(migration.up)
        await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [migration.version, migration.checksum])
        await client.query('commit')
        console.log(`Applied ${migration.version}`)
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [1_943_494_471]).catch(() => undefined)
    client.release()
    await db.end()
  }
}

async function main() {
  const action = process.argv[2] === 'reset' ? 'reset' : 'up'
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://dig:dig-local-only@127.0.0.1:5432/dig'
  await migrate(databaseUrl, action)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
