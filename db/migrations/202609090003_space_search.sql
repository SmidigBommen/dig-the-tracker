-- migrate:up
create index tasks_search_idx on team.tasks using gin (to_tsvector('simple', title || ' ' || description));
create index tags_search_idx on team.tags using gin (to_tsvector('simple', name));
create index identities_search_idx on team.identities using gin (to_tsvector('simple', display_name));
create index task_tags_search_idx on team.task_tags(space_id,tag_id,task_id);
create index tasks_assignee_search_idx on team.tasks(space_id,assignee_id,number);

-- migrate:down
drop index team.tasks_assignee_search_idx;
drop index team.task_tags_search_idx;
drop index team.identities_search_idx;
drop index team.tags_search_idx;
drop index team.tasks_search_idx;
