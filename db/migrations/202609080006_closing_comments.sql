-- migrate:up
alter table team.task_events add constraint task_events_space_id_id_unique unique (space_id, id);
alter table team.task_comments add column origin_event_id bigint unique,
  add constraint task_comments_origin_space_fk foreign key (space_id, origin_event_id) references team.task_events(space_id, id);
insert into team.task_comments (space_id, task_id, author_member_id, text, created_at, origin_event_id)
  select space_id, task_id, actor_member_id, details->>'comment', occurred_at, id
  from team.task_events where kind = 'closed' and char_length(btrim(coalesce(details->>'comment', ''))) > 0;

-- migrate:down
alter table team.task_comments drop column origin_event_id;
alter table team.task_events drop constraint task_events_space_id_id_unique;
