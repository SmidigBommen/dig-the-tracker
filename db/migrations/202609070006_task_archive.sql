-- migrate:up
alter table team.tasks add column archived_at timestamptz;
drop index team.tasks_column_page_idx;
create index tasks_column_page_idx on team.tasks (space_id, column_id, number) where archived_at is null;
create index tasks_archive_page_idx on team.tasks (space_id, number) where archived_at is not null;

create table team.task_events (
  id bigint generated always as identity primary key,
  space_id uuid not null references team.spaces(id) on delete cascade,
  task_id uuid not null,
  actor_member_id uuid not null,
  kind text not null,
  details jsonb not null,
  occurred_at timestamptz not null default now(),
  foreign key (space_id, task_id) references team.tasks(space_id, id) on delete cascade,
  foreign key (space_id, actor_member_id) references team.members(space_id, id)
);
create index task_events_page_idx on team.task_events (space_id, task_id, id);

-- migrate:down
drop table team.task_events;
drop index team.tasks_column_page_idx;
drop index team.tasks_archive_page_idx;
create index tasks_column_page_idx on team.tasks (space_id, column_id, number);
alter table team.tasks drop column archived_at;
