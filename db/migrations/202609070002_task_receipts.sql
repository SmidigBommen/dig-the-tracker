-- migrate:up
create table team.board_request_receipts (
  space_id uuid not null references team.spaces(id) on delete cascade,
  member_id uuid not null,
  request_id text not null check (char_length(request_id) between 1 and 100),
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (space_id, member_id, request_id),
  foreign key (space_id, member_id) references team.members(space_id, id)
);

create table team.board_updates (
  space_id uuid not null references team.spaces(id) on delete cascade,
  sequence bigint not null,
  update jsonb not null,
  occurred_at timestamptz not null default now(),
  primary key (space_id, sequence)
);

-- migrate:down
drop table team.board_updates;
drop table team.board_request_receipts;
