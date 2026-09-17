-- migrate:up
alter table team.agent_connections drop constraint agent_connections_scope_check;
alter table team.agent_connections add constraint agent_connections_scope_check check (scope in ('tasks:read','tasks:work'));
alter table team.spaces add column agent_work_epoch integer not null default 1;
create function team.advance_agent_work_epoch() returns trigger language plpgsql as $$
begin
  if new.lifecycle is distinct from old.lifecycle then new.agent_work_epoch=old.agent_work_epoch+1; end if;
  return new;
end $$;
create trigger space_agent_work_epoch before update of lifecycle on team.spaces for each row execute function team.advance_agent_work_epoch();
create table team.agent_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references team.agent_connections(id) on delete cascade,
  connection_revision integer not null,
  space_id uuid not null references team.spaces(id) on delete cascade,
  member_id uuid not null,
  member_joined_at timestamptz not null,
  policy_revision integer not null,
  space_epoch integer not null,
  request_id text not null check (char_length(request_id) between 1 and 100),
  label text not null check (char_length(label) between 1 and 120),
  created_at timestamptz not null default now(),
  unique(connection_id,request_id),
  unique(space_id,id),
  foreign key(space_id,member_id) references team.members(space_id,id) on delete cascade
);
create table team.task_claims (
  id uuid not null unique default gen_random_uuid(),
  space_id uuid not null,
  task_id uuid primary key,
  run_id uuid not null,
  started_at timestamptz not null default now(),
  checked_in_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key(space_id,task_id) references team.tasks(space_id,id) on delete cascade,
  foreign key(space_id,run_id) references team.agent_runs(space_id,id) on delete cascade
);
create function team.invalidate_task_claim() returns trigger language plpgsql as $$
begin
  if new.assignee_id is distinct from old.assignee_id or new.archived_at is distinct from old.archived_at or new.closed_at is distinct from old.closed_at then
    delete from team.task_claims where task_id=new.id;
  end if;
  return new;
end $$;
create trigger task_claim_invalidation after update of assignee_id,archived_at,closed_at on team.tasks for each row execute function team.invalidate_task_claim();
alter table team.task_comments add column agent_attribution jsonb;
-- migrate:down
alter table team.task_comments drop column agent_attribution;
drop trigger task_claim_invalidation on team.tasks;
drop function team.invalidate_task_claim();
drop table team.task_claims;
drop table team.agent_runs;
drop trigger space_agent_work_epoch on team.spaces;
drop function team.advance_agent_work_epoch();
alter table team.spaces drop column agent_work_epoch;
-- A rollback removes write consent; it must not convert write tokens to read tokens.
delete from team.agent_connections where scope='tasks:work';
alter table team.agent_connections drop constraint agent_connections_scope_check;
alter table team.agent_connections add constraint agent_connections_scope_check check(scope='tasks:read');
