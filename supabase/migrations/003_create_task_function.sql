-- Atomic task creation: generates number + inserts in a single transaction.
-- Run this in the Supabase SQL Editor.

create or replace function public.create_task(
  p_board_id uuid,
  p_title text,
  p_description text default '',
  p_column_slug text default 'backlog',
  p_priority text default 'medium',
  p_position integer default 0,
  p_assignee_name text default '',
  p_created_by_name text default '',
  p_created_by_id uuid default null,
  p_assignee_id uuid default null,
  p_tags text[] default '{}',
  p_parent_id uuid default null,
  p_subtask_ids uuid[] default '{}'
)
returns json
language plpgsql
security definer
as $$
declare
  v_number integer;
  v_task public.tasks;
begin
  -- Verify caller is a board member
  if not public.is_board_member(p_board_id) then
    raise exception 'Not a board member';
  end if;

  -- Atomic number generation + insert in single transaction
  select coalesce(max(number), 0) + 1 into v_number
  from public.tasks where board_id = p_board_id;

  insert into public.tasks (
    board_id, number, title, description, column_slug, priority,
    position, assignee_name, created_by_name, created_by_id,
    assignee_id, tags, parent_id, subtask_ids
  ) values (
    p_board_id, v_number, p_title, p_description, p_column_slug, p_priority,
    p_position, p_assignee_name, p_created_by_name, p_created_by_id,
    p_assignee_id, p_tags, p_parent_id, p_subtask_ids
  ) returning * into v_task;

  return row_to_json(v_task);
end;
$$;
