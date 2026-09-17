import { agentReportLimits } from '../../contracts/board.js'
import type { DbClient } from '../../db.js'
import type { BoardCommand,TaskHistoryEntry } from '../../contracts/board.js'
import type { TaskRow } from './private-task-summary.js'
import { readWorkflow,requireAgentWorkSettings } from './private-workflow.js'
import { BoardRejection } from './private-cursors.js'
import { addComment } from './private-comments.js'
import { notify } from './private-notifications.js'
import { recordEvent } from './private-history.js'
import { placeTask } from './private-placement.js'
import { transitionTask } from './private-flow.js'

type ReportCommand=Extract<BoardCommand,{kind:'report-blocker'|'handoff-review'}>
function text(value:unknown,field:string,max:number):string {
  if(typeof value!=='string' || !value.trim() || [...value].length>max)throw new BoardRejection({kind:'invalid',issues:[{field,message:`Use 1 to ${max} characters.`}]})
  return value.trim()
}
function formatReport(command:ReportCommand):string {
  const report=command.report
  const summary=text(report?.summary,'report.summary',agentReportLimits.summary)
  if(command.kind==='report-blocker')return `Blocker\n\n${summary}\n\nHelp needed\n${text(command.report.needed,'report.needed',agentReportLimits.needed)}`
  const review=command.report
  const labels={passed:'Passed',failed:'Failed','not-run':'Not run'}
  if(!review.verification || !Object.hasOwn(labels,review.verification.outcome))throw new BoardRejection({kind:'invalid',issues:[{field:'report.verification.outcome',message:'Choose passed, failed, or not-run.'}]})
  return `Ready for human review\n\n${summary}\n\nVerification: ${labels[review.verification.outcome]}\n${text(review.verification.details,'report.verification.details',agentReportLimits.verification)}\n\nKnown limitations\n${text(review.limitations,'report.limitations',agentReportLimits.limitations)}${review.reference===undefined ? '' : `\n\nPR or commit reference\n${text(review.reference,'report.reference',agentReportLimits.reference)}`}`
}
// Caller holds the Board lock and has rechecked the private run, claim, and Task revision.
export async function finishAgentReport(client:DbClient,spaceId:string,actorId:string,task:TaskRow,command:ReportCommand) {
  const body=formatReport(command)
  const events:TaskHistoryEntry[]=[]
  if(command.kind==='handoff-review') {
    const settings=await requireAgentWorkSettings(client,spaceId)
    const workflow=await readWorkflow(client,spaceId)
    if(workflow.revision!==command.expectedWorkflowRevision)throw new BoardRejection({kind:'conflict',reason:'stale-workflow'})
    const destination=workflow.columns.find(column=>column.id===settings.reviewColumnId)!
    if(task.column_id!==destination.id) {
      await placeTask(client,spaceId,task,{columnId:destination.id,expectedOrderRevision:destination.orderRevision,place:{kind:'last'}})
      events.push(...await transitionTask(client,spaceId,actorId,task,destination.id))
    }
  }
  const reportKind=command.kind==='report-blocker' ? 'blocked' : 'review'
  const comment=await addComment(client,spaceId,task.id,actorId,body,command.mentions,reportKind)
  await notify(client,spaceId,actorId,task.id,[{memberId:actorId,kind:reportKind==='blocked' ? 'agent-blocked' : 'agent-review'}],comment.id)
  await client.query('delete from team.task_claims where space_id=$1 and task_id=$2',[spaceId,task.id])
  events.push(await recordEvent(client,spaceId,task.id,actorId,reportKind==='blocked' ? 'agent-blocked' : 'agent-review',{}))
  return {comment,events}
}
