-- migrate:up
alter table team.tasks add column parent_task_id uuid,
  add constraint tasks_parent_space_fk foreign key (space_id, parent_task_id) references team.tasks(space_id, id),
  add constraint tasks_not_own_parent check (parent_task_id <> id);
create index tasks_parent_page_idx on team.tasks (space_id, parent_task_id, number);

-- migrate:down
drop index team.tasks_parent_page_idx;
alter table team.tasks drop column parent_task_id;
