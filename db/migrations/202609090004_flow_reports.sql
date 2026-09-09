-- migrate:up
create index tasks_age_idx on team.tasks(space_id,column_id,column_entered_at,id) where archived_at is null;
create index tasks_workload_idx on team.tasks(space_id,assignee_id,column_id,column_entered_at,id) where archived_at is null;
create index tasks_cycle_idx on team.tasks(space_id,closed_at) include (started_at) where closed_at is not null;
create index task_closures_report_idx on team.task_events(space_id,occurred_at) where kind='closed';

-- migrate:down
drop index team.task_closures_report_idx;
drop index team.tasks_cycle_idx;
drop index team.tasks_workload_idx;
drop index team.tasks_age_idx;
