import type { DbClient } from '../../db.js'
import type { TaskSelection, Page, TaskSummary } from '../../contracts/board.js'
import type { PageRequest } from '../shared.js'
import { BoardRejection, decodeCursor, encodeCursor, pageSize } from './private-cursors.js'
import { taskSummary, type TaskRow } from './private-task-summary.js'

export async function searchTasks(client: DbClient, spaceId: string, spaceKey: string, sequence: number,
  selection: Extract<TaskSelection, { kind: 'search' }>, page?: PageRequest): Promise<Page<TaskSummary>> {
  if (typeof selection.text !== 'string' || [...selection.text].length > 200
    || selection.include !== undefined && !['open','closed','archived','all'].includes(selection.include)) {
    throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'search', message: 'Use up to 200 characters and a valid Task scope.' }] })
  }
  const text = selection.text.trim(), include = selection.include ?? 'open'
  const scope = `${spaceId}:search:${JSON.stringify([text,include])}`
  const after = decodeCursor(page?.after, scope, sequence)
  const size = pageSize(page?.size)
  const keyMatch = text.toUpperCase().match(/^([A-Z][A-Z0-9]*)-([1-9][0-9]*)$/)
  const number = keyMatch?.[1] === spaceKey && keyMatch[2].length < 19 ? keyMatch[2] : null
  const state = include === 'open' ? 't.archived_at is null and t.closed_at is null'
    : include === 'closed' ? 't.archived_at is null and t.closed_at is not null'
    : include === 'archived' ? 't.archived_at is not null' : 'true'
  const result = await client.query<TaskRow>(`with query as materialized (
    select coalesce(to_tsquery('simple', string_agg(quote_literal(word) || ':*', ' & ')), ''::tsquery) as terms
    from unnest(tsvector_to_array(to_tsvector('simple', $2))) word
  ), matches as (
    select id from team.tasks, query where space_id=$1 and to_tsvector('simple', title || ' ' || description) @@ terms
    union select link.task_id from team.tags tag join team.task_tags link on link.space_id=tag.space_id and link.tag_id=tag.id, query
      where tag.space_id=$1 and to_tsvector('simple',tag.name) @@ terms
    union select task.id from team.members member join team.identities person on person.id=member.identity_id
      join team.tasks task on task.space_id=member.space_id and task.assignee_id=member.id, query
      where member.space_id=$1 and to_tsvector('simple',person.display_name) @@ terms
    union select id from team.tasks where space_id=$1 and number=$3::bigint
  ) select t.*, $4::text as space_key from team.tasks t
    where t.space_id=$1 and ${state} and ($2='' or t.id in (select id from matches))
      and ($5::bigint is null or t.number > $5) order by t.number limit $6`, [spaceId,text,number,spaceKey,after ?? null,size+1])
  const rows = result.rows.slice(0,size)
  const items: TaskSummary[] = []
  for (const row of rows) items.push(await taskSummary(client,row))
  return { items, ...(result.rows.length > size ? { next: encodeCursor(scope,sequence,rows.at(-1)!.number) } : {}) }
}
