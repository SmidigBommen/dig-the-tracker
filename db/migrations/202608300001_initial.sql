-- migrate:up
create extension if not exists pgcrypto;

create table actors (
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 50),
  avatar_color text not null check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table boards (
  id uuid primary key,
  name text not null,
  next_task_number integer not null default 1 check (next_task_number > 0),
  created_at timestamptz not null default now()
);

create table columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 30),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text not null default '',
  position integer not null,
  is_protected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (board_id, slug)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  number integer not null,
  title text not null check (char_length(title) between 3 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  column_slug text not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  position integer not null,
  assignee_name text not null default '',
  created_by_name text not null,
  created_by_id uuid not null references actors(id),
  tags text[] not null default '{}',
  parent_id uuid references tasks(id) on delete cascade,
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, number),
  foreign key (board_id, column_slug) references columns(board_id, slug)
);

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  board_id uuid not null references boards(id) on delete cascade,
  author_id uuid not null references actors(id),
  author_name text not null,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

create index columns_board_position_idx on columns(board_id, position);
create index tasks_board_column_position_idx on tasks(board_id, column_slug, position);
create index tasks_parent_idx on tasks(parent_id);
create index task_comments_task_created_idx on task_comments(task_id, created_at);

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger actors_updated_at before update on actors
for each row execute function set_updated_at();

create trigger tasks_updated_at before update on tasks
for each row execute function set_updated_at();

insert into actors (id, display_name, avatar_color)
values ('00000000-0000-4000-8000-000000000001', 'Local User', '#6366f1');

insert into boards (id, name)
values ('00000000-0000-4000-8000-000000000010', 'Dig Tracker');

insert into columns (board_id, slug, title, color, icon, position, is_protected) values
  ('00000000-0000-4000-8000-000000000010', 'backlog', 'Backlog', '#6b7280', '📋', 0, true),
  ('00000000-0000-4000-8000-000000000010', 'todo', 'To Do', '#3b82f6', '📝', 1000, false),
  ('00000000-0000-4000-8000-000000000010', 'in-progress', 'In Progress', '#f59e0b', '⚡', 2000, false),
  ('00000000-0000-4000-8000-000000000010', 'review', 'Review', '#8b5cf6', '🔍', 3000, false),
  ('00000000-0000-4000-8000-000000000010', 'done', 'Done', '#10b981', '✅', 4000, true);

-- migrate:down
drop table if exists task_comments;
drop table if exists tasks;
drop table if exists columns;
drop table if exists boards;
drop table if exists actors;
drop function if exists set_updated_at();
