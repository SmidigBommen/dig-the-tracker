-- migrate:up
create table team.tags (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references team.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  unique (space_id, id)
);
create unique index tags_name_idx on team.tags (space_id, lower(name));
create table team.task_tags (
  space_id uuid not null references team.spaces(id) on delete cascade,
  task_id uuid not null,
  tag_id uuid not null,
  primary key (space_id, task_id, tag_id),
  foreign key (space_id, task_id) references team.tasks(space_id, id) on delete cascade,
  foreign key (space_id, tag_id) references team.tags(space_id, id)
);

-- migrate:down
drop table team.task_tags;
drop table team.tags;
