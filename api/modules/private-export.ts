import { createHmac, randomBytes } from 'node:crypto'
import type { DbClient } from '../db.js'

// IDs have meaning only inside this download. Database keys never cross it.
export class ExportIds {
  private salt = randomBytes(32)
  ref(kind: string, value: unknown): string | null {
    if (value === null || value === undefined) return null
    return `${kind}-${createHmac('sha256',this.salt).update(`${kind}:${String(value)}`).digest('hex')}`
  }
}
export class ExportStopped extends Error {
  constructor(readonly kind: 'forbidden' | 'temporarily-unavailable') { super('Export stopped') }
}
export type ExportRow = Record<string,unknown>
export async function* exportRows(client: DbClient, sql: string, spaceId: string, check: () => Promise<void>): AsyncGenerator<ExportRow> {
  await client.query(`declare export_rows no scroll cursor for ${sql}`,[spaceId])
  try {
    while (true) {
      await check()
      const result = await client.query<ExportRow>('fetch forward 250 from export_rows')
      for (const row of result.rows) yield row
      if (result.rows.length < 250) break
    }
  } finally { await client.query('close export_rows') }
}
export async function* exportArray(name: string, rows: AsyncIterable<ExportRow>, ids: ExportIds,
  references: Record<string,string>, transform?: (row: ExportRow) => ExportRow): AsyncGenerator<string> {
  yield `,${JSON.stringify(name)}:[`
  let first = true
  for await (let row of rows) {
    if (transform) row = transform(row)
    for (const [field,kind] of Object.entries(references)) row[field] = ids.ref(kind,row[field])
    yield `${first ? '' : ','}${JSON.stringify(row)}`
    first = false
  }
  yield ']'
}
