# Dig — Issue Tracker

A kanban-style issue tracker built with React, TypeScript, and Vite.

**Live demo:** https://smidigbommen.github.io/dig-the-tracker/

## Features

- Kanban board with columns: Backlog, To Do, In Progress, Review, Done
- Drag-and-drop reordering of cards within and across columns
- Task creation with title, description, priority, assignee, and tags
- Subtask support (parent/child relationships)
- Comments on tasks
- Search and filter by priority
- Reports view with task statistics
- User profile settings
- Data persisted to localStorage

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
- Vitest + Testing Library
- Nginx (production container)
