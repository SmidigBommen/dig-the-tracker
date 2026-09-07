-- migrate:up
alter table team.tasks
  add column assignee_id uuid,
  add column closed_at timestamptz,
  add constraint tasks_assignee_space_fk foreign key (space_id, assignee_id) references team.members(space_id, id);
create index tasks_open_assignee_idx on team.tasks (space_id, assignee_id) where closed_at is null;

-- migrate:down
drop index team.tasks_open_assignee_idx;
alter table team.tasks drop column assignee_id, drop column closed_at;
