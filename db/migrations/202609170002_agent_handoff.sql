-- migrate:up
alter table team.boards add column agent_work_enabled boolean not null default false;
alter table team.boards add column agent_review_column_id uuid;
alter table team.boards add constraint board_agent_review_fk foreign key(space_id,agent_review_column_id) references team.board_columns(space_id,id);
alter table team.boards add constraint board_agent_review_required check(not agent_work_enabled or agent_review_column_id is not null);
-- Existing work waits for an administrator to select its review destination.
-- End temporary reservations without changing Tasks, assignments, or connections.
delete from team.task_claims;
alter table team.task_comments add column agent_report_kind text check(agent_report_kind in ('blocked','review'));
alter table team.notifications add column agent_attribution jsonb;
alter table team.notifications drop constraint notifications_kind_check;
alter table team.notifications drop constraint notifications_check;
alter table team.notifications add constraint notifications_kind_check check(kind in ('assignment','mention','comment','agent-blocked','agent-review'));
alter table team.notifications add constraint notifications_self_check check(recipient_member_id <> actor_member_id or (kind in ('agent-blocked','agent-review') and agent_attribution is not null));
alter table team.notifications add constraint notifications_agent_report_check check(kind not in ('agent-blocked','agent-review') or agent_attribution is not null);
-- migrate:down
delete from team.notifications where kind in ('agent-blocked','agent-review');
alter table team.notifications drop constraint notifications_agent_report_check;
alter table team.notifications drop constraint notifications_self_check;
alter table team.notifications drop constraint notifications_kind_check;
alter table team.notifications add constraint notifications_check check(recipient_member_id <> actor_member_id);
alter table team.notifications add constraint notifications_kind_check check(kind in ('assignment','mention','comment'));
alter table team.notifications drop column agent_attribution;
alter table team.task_comments drop column agent_report_kind;
alter table team.boards drop constraint board_agent_review_required;
alter table team.boards drop constraint board_agent_review_fk;
alter table team.boards drop column agent_review_column_id;
alter table team.boards drop column agent_work_enabled;
