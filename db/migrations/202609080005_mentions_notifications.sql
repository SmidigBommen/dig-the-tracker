-- migrate:up
create table team.comment_mentions (
  space_id uuid not null references team.spaces(id) on delete cascade,
  comment_id uuid not null,
  member_id uuid not null,
  primary key (space_id, comment_id, member_id),
  foreign key (space_id, comment_id) references team.task_comments(space_id, id) on delete cascade,
  foreign key (space_id, member_id) references team.members(space_id, id)
);
create table team.member_inboxes (
  space_id uuid not null references team.spaces(id) on delete cascade,
  member_id uuid not null,
  revision integer not null default 1,
  primary key (space_id, member_id),
  foreign key (space_id, member_id) references team.members(space_id, id) on delete cascade
);
create table team.notifications (
  id uuid primary key default gen_random_uuid(),
  ordering_key bigint generated always as identity unique,
  space_id uuid not null references team.spaces(id) on delete cascade,
  recipient_member_id uuid not null,
  actor_member_id uuid not null,
  task_id uuid not null,
  comment_id uuid,
  kind text not null check (kind in ('assignment', 'mention', 'comment')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  read_at timestamptz,
  foreign key (space_id, recipient_member_id) references team.members(space_id, id),
  foreign key (space_id, actor_member_id) references team.members(space_id, id),
  foreign key (space_id, task_id) references team.tasks(space_id, id) on delete cascade,
  foreign key (space_id, comment_id) references team.task_comments(space_id, id),
  check (recipient_member_id <> actor_member_id)
);
create index notifications_inbox_idx on team.notifications (space_id, recipient_member_id, ordering_key desc);
create index notifications_expiry_idx on team.notifications (space_id, expires_at);

-- migrate:down
drop table team.notifications;
drop table team.member_inboxes;
drop table team.comment_mentions;
