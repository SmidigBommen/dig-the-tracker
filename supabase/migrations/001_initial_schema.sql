-- Dig Tracker: Initial schema for multi-user Supabase migration
-- Run this in the Supabase SQL Editor

-- ============================================================
-- Tables
-- ============================================================

-- User profiles (linked to auth.users)
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_color text not null default '#6366f1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Boards
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Dig Tracker',
  created_at timestamptz not null default now()
);

-- Board members
create table public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  joined_at timestamptz not null default now(),
  unique (board_id, user_id)
);

-- Board invite shares
create table public.board_shares (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

-- Columns
create table public.columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  slug text not null,
  title text not null,
  color text not null default '#6b7280',
  icon text not null default '',
  position integer not null default 0,
  is_protected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (board_id, slug)
);

-- Tasks
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  number integer not null,
  title text not null,
  description text not null default '',
  column_slug text not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  position integer not null default 0,
  assignee_name text not null default '',
  created_by_name text not null default '',
  created_by_id uuid references auth.users(id) on delete set null,
  assignee_id uuid references auth.users(id) on delete set null,
  tags text[] not null default '{}',
  parent_id uuid references public.tasks(id) on delete cascade,
  subtask_ids uuid[] not null default '{}',
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, number)
);

-- Task comments (separate table for realtime)
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  text text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================

create index idx_board_members_board on public.board_members(board_id);
create index idx_board_members_user on public.board_members(user_id);
create index idx_columns_board on public.columns(board_id);
create index idx_tasks_board on public.tasks(board_id);
create index idx_tasks_column on public.tasks(board_id, column_slug);
create index idx_tasks_parent on public.tasks(parent_id);
create index idx_task_comments_task on public.task_comments(task_id);
create index idx_task_comments_board on public.task_comments(board_id);
create index idx_board_shares_token on public.board_shares(token);

-- ============================================================
-- Functions
-- ============================================================

-- Atomic next task number
create or replace function public.next_task_number(p_board_id uuid)
returns integer
language sql
volatile
as $$
  select coalesce(max(number), 0) + 1 from public.tasks where board_id = p_board_id;
$$;

-- Create default board with default columns for a new user
create or replace function public.create_default_board(p_user_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_board_id uuid;
begin
  -- Create the board
  insert into public.boards (name)
  values ('Dig Tracker')
  returning id into v_board_id;

  -- Add user as owner
  insert into public.board_members (board_id, user_id, role)
  values (v_board_id, p_user_id, 'owner');

  -- Create default columns
  insert into public.columns (board_id, slug, title, color, icon, position, is_protected)
  values
    (v_board_id, 'backlog', 'Backlog', '#6b7280', '📋', 0, true),
    (v_board_id, 'todo', 'To Do', '#3b82f6', '📝', 1000, false),
    (v_board_id, 'in-progress', 'In Progress', '#f59e0b', '⚡', 2000, false),
    (v_board_id, 'review', 'Review', '#8b5cf6', '🔍', 3000, false),
    (v_board_id, 'done', 'Done', '#10b981', '✅', 4000, true);

  return v_board_id;
end;
$$;

-- Accept an invite link (security definer to bypass RLS)
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_share record;
begin
  -- Find valid share
  select * into v_share
  from public.board_shares
  where token = p_token and expires_at > now();

  if not found then
    raise exception 'Invalid or expired invite link';
  end if;

  -- Add user as editor (ignore if already a member)
  insert into public.board_members (board_id, user_id, role)
  values (v_share.board_id, auth.uid(), 'editor')
  on conflict (board_id, user_id) do nothing;

  return v_share.board_id;
end;
$$;

-- Auto-update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.handle_updated_at();

create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.handle_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.user_profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.board_shares enable row level security;
alter table public.columns enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;

-- Helper: check if user is a member of a board
create or replace function public.is_board_member(p_board_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.board_members
    where board_id = p_board_id and user_id = auth.uid()
  );
$$;

-- user_profiles: users can read all profiles, update only their own
create policy "Users can view all profiles"
  on public.user_profiles for select
  to authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.user_profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "Users can update their own profile"
  on public.user_profiles for update
  to authenticated
  using (id = auth.uid());

-- boards: members can read their boards
create policy "Members can view their boards"
  on public.boards for select
  to authenticated
  using (public.is_board_member(id));

-- board_members: members can view members of their boards
create policy "Members can view board members"
  on public.board_members for select
  to authenticated
  using (public.is_board_member(board_id));

-- board_shares: members can create/view shares for their boards
create policy "Members can view board shares"
  on public.board_shares for select
  to authenticated
  using (public.is_board_member(board_id));

create policy "Members can create board shares"
  on public.board_shares for insert
  to authenticated
  with check (public.is_board_member(board_id));

-- columns: board members can CRUD
create policy "Members can view columns"
  on public.columns for select
  to authenticated
  using (public.is_board_member(board_id));

create policy "Members can insert columns"
  on public.columns for insert
  to authenticated
  with check (public.is_board_member(board_id));

create policy "Members can update columns"
  on public.columns for update
  to authenticated
  using (public.is_board_member(board_id));

create policy "Members can delete columns"
  on public.columns for delete
  to authenticated
  using (public.is_board_member(board_id));

-- tasks: board members can CRUD
create policy "Members can view tasks"
  on public.tasks for select
  to authenticated
  using (public.is_board_member(board_id));

create policy "Members can insert tasks"
  on public.tasks for insert
  to authenticated
  with check (public.is_board_member(board_id));

create policy "Members can update tasks"
  on public.tasks for update
  to authenticated
  using (public.is_board_member(board_id));

create policy "Members can delete tasks"
  on public.tasks for delete
  to authenticated
  using (public.is_board_member(board_id));

-- task_comments: board members can CRUD
create policy "Members can view comments"
  on public.task_comments for select
  to authenticated
  using (public.is_board_member(board_id));

create policy "Members can insert comments"
  on public.task_comments for insert
  to authenticated
  with check (public.is_board_member(board_id));

create policy "Members can delete comments"
  on public.task_comments for delete
  to authenticated
  using (public.is_board_member(board_id));

-- ============================================================
-- Realtime
-- ============================================================

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.task_comments;
alter publication supabase_realtime add table public.columns;
alter publication supabase_realtime add table public.board_members;
