-- migrate:up
create table team.tasks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references team.spaces(id) on delete cascade,
  number bigint not null check (number > 0),
  column_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 20000),
  revision integer not null default 1 check (revision > 0),
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, id),
  unique (space_id, number),
  foreign key (space_id, column_id) references team.board_columns(space_id, id),
  foreign key (space_id, created_by_member_id) references team.members(space_id, id)
);

create index tasks_column_page_idx on team.tasks (space_id, column_id, number);

-- migrate:down
drop table team.tasks;
