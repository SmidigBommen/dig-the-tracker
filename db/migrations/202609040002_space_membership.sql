-- migrate:up
alter table team.spaces
  add column archived_at timestamptz,
  add column deletion_scheduled_for timestamptz;

alter table team.members
  add constraint members_space_id_id_unique unique (space_id, id);

create table team.space_invitations (
  id uuid primary key,
  space_id uuid not null references team.spaces(id) on delete cascade,
  secret_hash text not null unique,
  issued_by_member_id uuid not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by_identity_id uuid references team.identities(id),
  unique (space_id, id),
  foreign key (space_id, issued_by_member_id) references team.members(space_id, id),
  check (expires_at > issued_at),
  check ((accepted_at is null) = (accepted_by_identity_id is null)),
  check (not (revoked_at is not null and accepted_at is not null))
);

create index space_invitations_pending_idx
  on team.space_invitations (space_id, expires_at, id)
  where revoked_at is null and accepted_at is null;

create table team.space_audit (
  id uuid primary key default gen_random_uuid(),
  ordering_key bigint generated always as identity unique,
  space_id uuid not null references team.spaces(id) on delete cascade,
  actor_identity_id uuid not null references team.identities(id),
  action text not null check (action in (
    'space-created', 'space-revised', 'invitation-issued', 'invitation-revoked',
    'invitation-accepted', 'member-role-changed', 'member-removed', 'member-left',
    'space-archived', 'space-restored', 'space-deletion-scheduled',
    'space-deletion-cancelled'
  )),
  subject_member_id uuid,
  invitation_id uuid,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  foreign key (space_id, subject_member_id) references team.members(space_id, id),
  foreign key (space_id, invitation_id) references team.space_invitations(space_id, id)
);

create index space_audit_order_idx on team.space_audit (space_id, occurred_at desc, ordering_key desc);

-- migrate:down
drop table if exists team.space_audit;
drop table if exists team.space_invitations;
alter table team.members drop constraint if exists members_space_id_id_unique;
alter table team.spaces
  drop column if exists deletion_scheduled_for,
  drop column if exists archived_at;
