-- migrate:up
create schema if not exists team;

create table team.identities (
  id uuid primary key default gen_random_uuid(),
  oidc_issuer text not null,
  oidc_subject text not null,
  display_name text not null check (char_length(display_name) between 1 and 100),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (oidc_issuer, oidc_subject)
);

create table team.sign_in_attempts (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  secret_hash text not null unique,
  nonce text not null,
  code_verifier text not null,
  return_to text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index sign_in_attempts_expiry_idx on team.sign_in_attempts (expires_at);

create table team.browser_sessions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references team.identities(id) on delete cascade,
  secret_hash text not null unique,
  created_at timestamptz not null,
  last_active_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  check (last_active_at >= created_at),
  check (absolute_expires_at > created_at)
);

create index browser_sessions_identity_idx on team.browser_sessions (identity_id);

create table team.space_key_reservations (
  space_key text primary key check (space_key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  reserved_at timestamptz not null,
  reserved_by_identity_id uuid references team.identities(id) on delete set null
);

create table team.spaces (
  id uuid primary key default gen_random_uuid(),
  space_key text not null unique references team.space_key_reservations(space_key),
  display_name text not null check (char_length(display_name) between 1 and 60),
  time_zone text not null check (char_length(time_zone) between 1 and 100),
  lifecycle text not null default 'active' check (lifecycle in ('active', 'archived', 'deletion_scheduled')),
  revision integer not null default 1 check (revision > 0),
  access_revision bigint not null default 1 check (access_revision > 0),
  created_by_identity_id uuid not null references team.identities(id),
  created_at timestamptz not null
);

create table team.members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references team.spaces(id) on delete cascade,
  identity_id uuid not null references team.identities(id),
  role text not null check (role in ('member', 'space-administrator')),
  revision integer not null default 1 check (revision > 0),
  joined_at timestamptz not null,
  ended_at timestamptz,
  unique (space_id, identity_id)
);

create index members_identity_active_idx on team.members (identity_id, space_id) where ended_at is null;

create table team.boards (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null unique references team.spaces(id) on delete cascade,
  next_task_number bigint not null default 1 check (next_task_number > 0),
  change_sequence bigint not null default 0 check (change_sequence >= 0),
  workflow_revision integer not null default 1 check (workflow_revision > 0),
  created_at timestamptz not null,
  unique (space_id, id)
);

create table team.board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  space_id uuid not null references team.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  flow_role text not null check (flow_role in ('queue', 'active', 'complete')),
  is_intake boolean not null default false,
  is_completion boolean not null default false,
  wip_limit integer,
  position integer not null,
  revision integer not null default 1 check (revision > 0),
  archived_at timestamptz,
  unique (space_id, id),
  unique (board_id, position),
  foreign key (space_id, board_id) references team.boards(space_id, id) on delete cascade,
  check ((flow_role = 'active' and wip_limit > 0) or (flow_role <> 'active' and wip_limit is null)),
  check (not is_intake or flow_role = 'queue'),
  check (not is_completion or flow_role = 'complete')
);

create unique index board_one_intake_idx on team.board_columns (board_id)
where is_intake and archived_at is null;

create unique index board_one_completion_idx on team.board_columns (board_id)
where is_completion and archived_at is null;

create index board_columns_order_idx on team.board_columns (board_id, position)
where archived_at is null;

create table team.space_request_receipts (
  identity_id uuid not null references team.identities(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 100),
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null,
  primary key (identity_id, request_id)
);

-- migrate:down
drop schema if exists team cascade;
