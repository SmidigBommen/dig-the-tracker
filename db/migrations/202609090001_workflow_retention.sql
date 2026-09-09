-- migrate:up
alter table team.board_columns
  add column previous_flow_role text not null default 'queue' check (previous_flow_role in ('queue', 'active')),
  add column previous_wip_limit integer;
update team.board_columns set previous_flow_role = flow_role, previous_wip_limit = wip_limit where flow_role <> 'complete';
alter table team.tasks add column restored_at timestamptz;
create index tasks_auto_archive_idx on team.tasks (space_id, closed_at, id) where archived_at is null and closed_at is not null;
create index spaces_due_deletion_idx on team.spaces (deletion_scheduled_for, id) where lifecycle = 'deletion_scheduled';
alter table team.task_events alter column actor_member_id drop not null;
alter table team.space_audit drop constraint space_audit_action_check;
alter table team.space_audit add constraint space_audit_action_check check (action in (
  'space-created', 'space-revised', 'invitation-issued', 'invitation-revoked', 'invitation-accepted',
  'member-role-changed', 'member-removed', 'member-left', 'space-archived', 'space-restored',
  'space-deletion-scheduled', 'space-deletion-cancelled', 'comment-moderated', 'workflow-changed'
));

-- migrate:down
alter table team.board_columns drop column previous_flow_role, drop column previous_wip_limit;
alter table team.tasks drop column restored_at;
drop index team.tasks_auto_archive_idx;
drop index team.spaces_due_deletion_idx;
delete from team.task_events where kind='auto-archive-task';
alter table team.task_events alter column actor_member_id set not null;
delete from team.space_audit where action='workflow-changed';
alter table team.space_audit drop constraint space_audit_action_check;
alter table team.space_audit add constraint space_audit_action_check check (action in (
  'space-created', 'space-revised', 'invitation-issued', 'invitation-revoked', 'invitation-accepted',
  'member-role-changed', 'member-removed', 'member-left', 'space-archived', 'space-restored',
  'space-deletion-scheduled', 'space-deletion-cancelled', 'comment-moderated'
));
