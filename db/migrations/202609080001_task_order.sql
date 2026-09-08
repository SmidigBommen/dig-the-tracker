-- migrate:up
alter table team.board_columns add column order_revision integer not null default 1;
alter table team.tasks add column rank bigint not null default 0;
update team.tasks set rank = number * 1024;
create index tasks_relative_page_idx on team.tasks (space_id, column_id, rank, number) where archived_at is null;

-- migrate:down
drop index team.tasks_relative_page_idx;
alter table team.tasks drop column rank;
alter table team.board_columns drop column order_revision;
