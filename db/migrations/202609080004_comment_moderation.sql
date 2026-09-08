-- migrate:up
alter table team.space_audit drop constraint space_audit_action_check;
alter table team.space_audit add constraint space_audit_action_check check (action in (
  'space-created', 'space-revised', 'invitation-issued', 'invitation-revoked',
  'invitation-accepted', 'member-role-changed', 'member-removed', 'member-left',
  'space-archived', 'space-restored', 'space-deletion-scheduled', 'space-deletion-cancelled', 'comment-moderated'
));

-- migrate:down
delete from team.space_audit where action = 'comment-moderated';
alter table team.space_audit drop constraint space_audit_action_check;
alter table team.space_audit add constraint space_audit_action_check check (action in (
  'space-created', 'space-revised', 'invitation-issued', 'invitation-revoked',
  'invitation-accepted', 'member-role-changed', 'member-removed', 'member-left',
  'space-archived', 'space-restored', 'space-deletion-scheduled', 'space-deletion-cancelled'
));
