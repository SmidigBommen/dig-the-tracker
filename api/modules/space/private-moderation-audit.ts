import type { DbClient } from '../../db.js'

// Board calls this inside its transaction after the Space, Member and Board rechecks.
export async function recordCommentModeration(client: DbClient, spaceId: string, actorIdentityId: string, taskId: string, commentId: string) {
  await client.query(`insert into team.space_audit (space_id, actor_identity_id, action, details, occurred_at)
    values ($1,$2,'comment-moderated',$3,now())`, [spaceId, actorIdentityId, { taskId, commentId }])
}
