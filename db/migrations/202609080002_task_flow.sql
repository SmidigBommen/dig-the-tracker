-- migrate:up
alter table team.tasks
  add column started_at timestamptz,
  add column column_entered_at timestamptz not null default now(),
  add column outcome text check (outcome in ('completed', 'rejected', 'cancelled', 'duplicate')),
  add column duplicate_task_id uuid,
  add constraint tasks_duplicate_space_fk foreign key (space_id, duplicate_task_id) references team.tasks(space_id, id),
  add constraint tasks_duplicate_not_self check (duplicate_task_id <> id);
update team.tasks set column_entered_at = created_at, outcome = case when closed_at is not null then 'completed' end;
alter table team.tasks
  add constraint tasks_closure_outcome check ((closed_at is null) = (outcome is null)),
  add constraint tasks_duplicate_outcome check ((outcome is not distinct from 'duplicate') = (duplicate_task_id is not null));

-- migrate:down
alter table team.tasks drop column started_at, drop column column_entered_at, drop column outcome, drop column duplicate_task_id;
