-- migrate:up
create table team.task_comments (
  id uuid primary key default gen_random_uuid(),
  ordering_key bigint generated always as identity unique,
  space_id uuid not null references team.spaces(id) on delete cascade,
  task_id uuid not null,
  author_member_id uuid not null,
  text text not null check (char_length(text) <= 5000),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  removed_at timestamptz,
  removed_by_member_id uuid,
  unique (space_id, id),
  foreign key (space_id, task_id) references team.tasks(space_id, id) on delete cascade,
  foreign key (space_id, author_member_id) references team.members(space_id, id),
  foreign key (space_id, removed_by_member_id) references team.members(space_id, id),
  check ((removed_at is null and char_length(btrim(text)) > 0) or (removed_at is not null and text = ''))
);
create index task_comments_page_idx on team.task_comments (space_id, task_id, ordering_key desc);

-- migrate:down
drop table team.task_comments;
