// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadMigrations, validateAppliedMigrations } from './migrate.js'

const temporaryDirectories: string[] = []

async function migrationDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'dig-migrations-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('migration loading', () => {
  it('sorts SQL migrations and separates their up and down sections', async () => {
    const directory = await migrationDirectory()
    await writeFile(join(directory, '002_second.sql'), '-- migrate:up\nselect 2;\n-- migrate:down\nselect -2;\n')
    await writeFile(join(directory, '001_first.sql'), '-- migrate:up\nselect 1;\n-- migrate:down\nselect -1;\n')

    const migrations = await loadMigrations(directory)

    expect(migrations.map(({ version }) => version)).toEqual(['001_first', '002_second'])
    expect(migrations[0]).toMatchObject({ up: 'select 1;', down: 'select -1;' })
    expect(migrations[0].checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a migration without an explicit rollback section', async () => {
    const directory = await migrationDirectory()
    await writeFile(join(directory, '001_invalid.sql'), '-- migrate:up\nselect 1;\n')

    await expect(loadMigrations(directory)).rejects.toThrow('missing a -- migrate:down marker')
  })

  it('rejects changed and out-of-order applied migrations', async () => {
    const directory = await migrationDirectory()
    await writeFile(join(directory, '001_first.sql'), '-- migrate:up\nselect 1;\n-- migrate:down\nselect -1;\n')
    await writeFile(join(directory, '002_second.sql'), '-- migrate:up\nselect 2;\n-- migrate:down\nselect -2;\n')
    const migrations = await loadMigrations(directory)

    expect(() => validateAppliedMigrations(migrations, [
      { version: migrations[0].version, checksum: 'changed' },
    ])).toThrow('has changed')
    expect(() => validateAppliedMigrations(migrations, [
      { version: migrations[1].version, checksum: migrations[1].checksum },
    ])).toThrow('not an ordered prefix')
  })
})
