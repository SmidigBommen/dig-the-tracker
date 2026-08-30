import pg from 'pg'

export type Database = pg.Pool
export type DbClient = pg.PoolClient

export function createDatabase(databaseUrl: string): Database {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 })
}

export async function inTransaction<T>(db: Database, operation: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('begin')
    const result = await operation(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
