-- migrate:up
drop table public.task_comments;
drop table public.tasks;
drop table public.columns;
drop table public.boards;
drop table public.actors;
drop function public.set_updated_at();

-- migrate:down
-- The confirmed clean-slate MVP does not retain or restore prototype data.
-- A full reset recreates the original schema through its initial migration.
select 1;
