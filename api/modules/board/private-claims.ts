import type { DbClient } from '../../db.js'
import type { TaskClaim,BoardCommand } from '../../contracts/board.js'
import type { inspectAuthorizedSpace } from '../private-capabilities.js'
import type { MemberId } from '../shared.js'
import { readLiveRun,type LiveRun } from '../agent/private-access.js'
import { appendUpdate } from './private-receipts.js'
import { BoardRejection } from './private-cursors.js'

type Claims=NonNullable<ReturnType<typeof inspectAuthorizedSpace>>
type ClaimCommand=Extract<BoardCommand,{kind:'claim-task'|'renew-task-claim'|'release-task-claim'}>
export async function currentClaim(client:DbClient,spaceId:string,taskId:string):Promise<TaskClaim|null> {
  const row=(await client.query<{id:string;run_id:string;started_at:Date;checked_in_at:Date;expires_at:Date;assignee_id:string}>(`select c.*,t.assignee_id from team.task_claims c
    join team.tasks t on t.id=c.task_id and t.space_id=c.space_id where c.space_id=$1 and c.task_id=$2
      and exists(select 1 from team.boards b where b.space_id=c.space_id and b.agent_work_enabled)
      and c.expires_at>coalesce(nullif(current_setting('dig.claim_clock',true),'')::timestamptz,now()) and t.archived_at is null and t.closed_at is null`,[spaceId,taskId])).rows[0]
  if(!row)return null
  const run=await readLiveRun(client,row.run_id,spaceId)
  if(!run || run.memberId!==row.assignee_id)return null
  return {id:row.id,runId:run.id,connectionId:run.connectionId,connectionName:run.connectionName,member:{id:run.memberId as MemberId,displayName:run.memberName},
    startedAt:row.started_at.toISOString(),lastCheckInAt:row.checked_in_at.toISOString(),expiresAt:new Date(Math.min(row.expires_at.getTime(),run.connectionExpiresAt.getTime())).toISOString()}
}
export async function requireRun(client:DbClient,claims:Claims):Promise<LiveRun> {
  const agent=claims.agent
  const run=agent?.runId ? await readLiveRun(client,agent.runId,claims.spaceId) : undefined
  if(!run || run.connectionId!==agent?.connectionId || run.connectionRevision!==agent.revision || run.memberId!==claims.memberId)
    throw new BoardRejection({kind:'conflict',reason:'run-invalid'})
  await client.query("select set_config('dig.agent_attribution',$1,true)",[JSON.stringify({runId:run.id,connectionId:run.connectionId,connectionName:run.connectionName})])
  return run
}
export async function changeClaim(client:DbClient,claims:Claims,command:ClaimCommand,role:string,now:Date):Promise<void> {
  const task=(await client.query<{id:string;assignee_id:string|null;closed_at:Date|null;archived_at:Date|null}>(`select id,assignee_id,closed_at,archived_at from team.tasks where space_id=$1 and id::text=$2`,[claims.spaceId,command.taskId])).rows[0]
  if(!task)throw new BoardRejection({kind:'not-found'})
  const claim=await currentClaim(client,claims.spaceId,task.id)
  if(command.kind==='release-task-claim') {
    if(!claim || claim.id!==command.claimId)throw new BoardRejection({kind:'conflict',reason:'claim-lost'})
    if(claims.agent ? claim.runId!==claims.agent.runId : claim.member.id!==claims.memberId && role!=='space-administrator')throw new BoardRejection({kind:'forbidden'})
    await client.query('delete from team.task_claims where task_id=$1',[task.id]);return
  }
  if(!claims.agent)throw new BoardRejection({kind:'forbidden'})
  if(task.archived_at || task.closed_at)throw new BoardRejection({kind:'invalid',issues:[{field:'task',message:'Choose an open, unarchived Task.'}]})
  if(task.assignee_id && task.assignee_id!==claims.memberId)throw new BoardRejection({kind:'conflict',reason:'assigned-to-another-member'})
  if(command.kind==='renew-task-claim') {
    if(!claim || claim.id!==command.claimId || claim.runId!==claims.agent.runId)throw new BoardRejection({kind:'conflict',reason:'claim-lost'})
    await client.query('update team.task_claims set checked_in_at=$2,expires_at=$3 where task_id=$1',[task.id,now,new Date(now.getTime()+7200000)]);return
  }
  if(claim && claim.runId!==claims.agent.runId)throw new BoardRejection({kind:'conflict',reason:'task-claimed'})
  if(claim)return
  if(!task.assignee_id)await client.query('update team.tasks set assignee_id=$2,revision=revision+1,updated_at=now() where id=$1',[task.id,claims.memberId])
  await client.query('delete from team.task_claims where task_id=$1',[task.id])
  await client.query('insert into team.task_claims(space_id,task_id,run_id,started_at,checked_in_at,expires_at) values($1,$2,$3,$4,$4,$5)',[claims.spaceId,task.id,claims.agent.runId,now,new Date(now.getTime()+7200000)])
}

export async function authorizeAgentCommand(client:DbClient,claims:Claims,command:BoardCommand):Promise<void> {
  if(!claims.agent) {
    if(command.kind==='report-blocker' || command.kind==='handoff-review')throw new BoardRejection({kind:'forbidden'})
    return
  }
  if(command.kind==='report-blocker' || command.kind==='handoff-review') {await requireClaim(client,claims,command.task.taskId);return}
  if(command.kind==='capture-task') {
    if(Object.keys(command.input).some(key=>!['title','description','tags','parentTaskId'].includes(key)))throw new BoardRejection({kind:'forbidden'})
    if(command.input.parentTaskId)await requireClaim(client,claims,command.input.parentTaskId)
    return
  }
  if(command.kind==='revise-task') {
    if(Object.keys(command.changes).some(key=>!['title','description','tags'].includes(key)))throw new BoardRejection({kind:'forbidden'})
    await requireClaim(client,claims,command.task.taskId);return
  }
  if(command.kind==='add-comment') {await requireClaim(client,claims,command.taskId);return}
  if(command.kind==='place-task') {
    await requireClaim(client,claims,command.task.taskId)
    if(command.closure)throw new BoardRejection({kind:'forbidden'})
    const column=(await client.query<{flow_role:string}>('select flow_role from team.board_columns where space_id=$1 and id::text=$2 and archived_at is null',[claims.spaceId,command.destination.columnId])).rows[0]
    if(!column)throw new BoardRejection({kind:'not-found'})
    if(column.flow_role==='complete')throw new BoardRejection({kind:'forbidden'})
    const review=await client.query('select id from team.boards where space_id=$1 and agent_review_column_id::text=$2',[claims.spaceId,command.destination.columnId])
    if(review.rowCount)throw new BoardRejection({kind:'conflict',reason:'review-handoff-required'})
    return
  }
  throw new BoardRejection({kind:'forbidden'})
}
async function requireClaim(client:DbClient,claims:Claims,taskId:string) {
  const claim=await currentClaim(client,claims.spaceId,taskId)
  if(!claim || claim.id!==claims.agent?.claimId || claim.runId!==claims.agent.runId)throw new BoardRejection({kind:'conflict',reason:'claim-lost'})
}

// Caller holds the affected Space locks before its credential/session locks.
export async function publishClaimInvalidation(client:DbClient,spaceIds:string[]):Promise<void> {
  for(const spaceId of [...spaceIds].sort()) {
    const locked=await client.query('select id from team.boards where space_id=$1 for update',[spaceId])
    if(!locked.rowCount)continue
    await appendUpdate(client,spaceId,[])
  }
}
