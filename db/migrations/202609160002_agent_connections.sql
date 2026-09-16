-- migrate:up
alter table team.spaces add column agent_access_enabled boolean not null default false;
alter table team.spaces add column agent_access_revision integer not null default 1 check (agent_access_revision > 0);
create table team.agent_connections (
  id uuid primary key,
  identity_id uuid not null references team.identities(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  scope text not null default 'tasks:read' check (scope = 'tasks:read'),
  secret_hash text not null unique,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index agent_connections_owner_idx on team.agent_connections(identity_id,created_at desc,id);
create table team.agent_space_grants (
  connection_id uuid not null references team.agent_connections(id) on delete cascade,
  space_id uuid not null references team.spaces(id) on delete cascade,
  member_id uuid not null,
  member_joined_at timestamptz not null,
  policy_revision integer not null,
  primary key (connection_id,space_id),
  foreign key (space_id,member_id) references team.members(space_id,id) on delete cascade
);
-- migrate:down
drop table team.agent_space_grants;
drop table team.agent_connections;
alter table team.spaces drop column agent_access_revision;
alter table team.spaces drop column agent_access_enabled;
