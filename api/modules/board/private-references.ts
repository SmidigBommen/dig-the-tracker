import type { DbClient } from '../../db.js'
import type { TaskReference } from '../../contracts/board.js'
import type { TaskKey } from '../shared.js'
import { BoardRejection } from './private-cursors.js'

export async function readReferences(client: DbClient,spaceId: string,spaceKey: string,keys: TaskKey[]): Promise<TaskReference[]> {
  if (!Array.isArray(keys) || keys.length > 50 || keys.some(key => typeof key !== 'string' || !/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,17}$/.test(key))) {
    throw new BoardRejection({ kind: 'invalid',issues: [{ field: 'keys',message: 'Use at most 50 Task keys.' }] })
  }
  const numbers = keys.filter(key => key.startsWith(`${spaceKey}-`)).map(key => key.split('-')[1])
  return (await client.query<TaskReference>(`select id,$2::text || '-' || number::text as key,$2::text as "spaceKey"
    from team.tasks where space_id=$1 and number=any($3::bigint[]) order by number`,[spaceId,spaceKey,numbers])).rows
}
