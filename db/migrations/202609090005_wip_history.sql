-- migrate:up
lock table team.tasks, team.task_events in share row exclusive mode;
create table team.board_wip_deltas (
  id bigint generated always as identity primary key,
  space_id uuid not null references team.spaces(id) on delete cascade,
  task_id uuid not null,
  column_id uuid not null,
  occurred_at timestamptz not null,
  delta integer not null check (delta in (-1,1)),
  foreign key (space_id,task_id) references team.tasks(space_id,id) on delete cascade,
  foreign key (space_id,column_id) references team.board_columns(space_id,id)
);
create index board_wip_period_idx on team.board_wip_deltas(space_id,occurred_at,column_id) include (delta);

-- Restore transitions start from archived work and always end in Queue or Complete.
insert into team.board_wip_deltas(space_id,task_id,column_id,occurred_at,delta)
select e.space_id,e.task_id,(part.value->>'id')::uuid,e.occurred_at,part.delta
from team.task_events e cross join lateral (values (e.details->'fromColumn',-1),(e.details->'toColumn',1)) part(value,delta)
where e.kind='column-transition' and part.value->>'flowRole'='active'
  and not exists (select 1 from team.task_events restored where restored.space_id=e.space_id and restored.task_id=e.task_id
    and restored.kind='restore-task' and restored.occurred_at=e.occurred_at);

insert into team.board_wip_deltas(space_id,task_id,column_id,occurred_at,delta)
select e.space_id,e.task_id,(previous.details->'toColumn'->>'id')::uuid,e.occurred_at,-1
from team.task_events e cross join lateral (
  select transition.details from team.task_events transition
  where transition.space_id=e.space_id and transition.task_id=e.task_id and transition.kind='column-transition' and transition.id<e.id
  order by transition.id desc limit 1
) previous
where e.kind in ('archive-task','auto-archive-task') and previous.details->'toColumn'->>'flowRole'='active';

-- Track occupancy where Tasks change, including family and scheduled changes and old runtimes.
create function team.track_active_occupancy() returns trigger language plpgsql as $$
declare old_active boolean := false; new_active boolean;
begin
  if tg_op='UPDATE' then
    if old.column_id=new.column_id and (old.archived_at is null)=(new.archived_at is null) then return new; end if;
    select flow_role='active' and old.archived_at is null into old_active from team.board_columns where space_id=old.space_id and id=old.column_id;
  end if;
  select flow_role='active' and new.archived_at is null into new_active from team.board_columns where space_id=new.space_id and id=new.column_id;
  if old_active then
    insert into team.board_wip_deltas(space_id,task_id,column_id,occurred_at,delta) values(old.space_id,old.id,old.column_id,now(),-1);
  end if;
  if new_active then
    insert into team.board_wip_deltas(space_id,task_id,column_id,occurred_at,delta) values(new.space_id,new.id,new.column_id,now(),1);
  end if;
  return new;
end;
$$;
create trigger active_occupancy after insert or update of column_id,archived_at on team.tasks
  for each row execute function team.track_active_occupancy();

-- migrate:down
drop trigger active_occupancy on team.tasks;
drop function team.track_active_occupancy();
drop table team.board_wip_deltas;
