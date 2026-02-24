# Dig — Issue Tracker

A multi-user kanban-style issue tracker built with React, TypeScript, and Supabase.

**Live demo:** https://smidigbommen.github.io/dig-the-tracker/

## Features

- Kanban board with customizable columns (Backlog, To Do, In Progress, Review, Done + custom)
- Drag-and-drop reordering of cards within and across columns
- Task creation with title, description, priority, assignee, and tags
- Subtask support with progress tracking
- Comments on tasks with auto-linked task references (DIG-N)
- Search by text or task ID, filter by priority
- Deep-linking to tasks via `#DIG-N` in the URL
- Reports view with task statistics
- Multi-user with magic link (passwordless) authentication
- Realtime sync across users via Supabase
- Invite teammates with shareable invite links
- User profile settings with display name and avatar color

## Usage

### Creating a task

1. Click **+ Add Task** on any column
2. Fill in the title (required), description, priority, assignee, and tags
3. Click **Create Task** — the task appears in the column with an auto-assigned DIG-N number

### Editing a task

1. Click any task card to open the detail view
2. Click **Edit** in the top-right corner
3. Update title, description, priority, assignee, or tags
4. Click **Save Changes**

### Moving tasks

- **Drag and drop** a task card between columns, or up and down within the same column to reorder
- Or open a task and change the **Status** dropdown in the detail view

### Subtasks

1. Open a task and click **+ Add Subtask**
2. Fill in the subtask details and submit
3. Subtasks appear with a progress bar showing completion (click the checkbox to toggle done)

### Comments

1. Open a task and scroll to the **Comments** section
2. Type your comment and click **Submit**
3. Task references like `DIG-5` are auto-linked

### Search and filter

- Use the **search bar** in the header to find tasks by title, description, or DIG-N number
- Use the **priority filter** dropdown to show only tasks of a specific priority

### Inviting teammates

1. Go to **Profile** (tab in the header)
2. Click **Generate Invite Link**
3. Share the link — teammates click it to join your board

## Getting Started

```sh
npm install
npm run dev
```

Open http://localhost:5173 to view the app.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build locally |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |
| `npm run container:build` | Build container image with Podman |
| `npm run container:run` | Run container on port 8080 |

## Container Deployment

Build and run with Podman:

```sh
podman-compose up --build
```

The app will be available at http://localhost:8080.

## Tech Stack

- React 19
- TypeScript
- Vite
- Supabase (Postgres, Auth, Realtime)
- Vitest + Testing Library
- Nginx (production container)
