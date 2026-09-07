# Slice 3: capture and shape work

Status: implemented on 2026-09-07.

Members can create, open, edit, assign, tag, archive, and restore Tasks and one-level Subtasks from the running Board.

## Delivered behavior

- Sequential Space Task numbers, stable opaque relationship IDs, and Intake placement for every capture.
- Plain-text titles and descriptions with Unicode character limits. Descriptions preserve line breaks and link HTTP/HTTPS URLs.
- One optional current Assignee. Member removal and leave unassign open Tasks inside the membership transaction, increment Task revisions, and record events.
- Space-scoped, case-insensitively unique Tags created inline, with bounded autocomplete. Tags keep their IDs across spelling-case changes in input.
- One-level Subtasks with their own keys and independently loaded pages.
- Task revisions and Member/Space-scoped idempotent receipts. A stale edit returns current detail; the browser preserves the draft beside it.
- Parent-family archive and restore. Restore returns open Tasks to Intake. Archived parents must restore before an individual Subtask can restore.
- Lane, Archive, Subtask, and Tag pages default to 50 and cap at 200. Encrypted cursors expire on Board changes, after one hour, or after a server restart.
- `BoardSession` with an HTTP `BoardTransport` Adapter, keyboard-accessible forms, focus handling, and connection-aware editing. An uncertain request keeps its ID for retry.
- Forward migrations for the team Task model and retirement of the unused prototype schema. The prototype service, repository, browser context, views, and obsolete tests are removed.

## Verification

`api/modules/slice-three.integration.test.ts` covers capture/reload, concurrent numbering, retries, stale edits, assignments and removal races, text limits, Tags, Subtask depth, foreign IDs, authorization, pages, family archive/restore, and authenticated HTTP parsing and CSRF.

The scale fixture contains 100,000 retained Tasks, with 90,000 archived. It verifies a 50-Task overview page, a 200-Task continuation, counts beyond the loaded page, detail lookup, and an indexed continuation query returning 51 database rows.

Browser tests exercise `BoardSession` at the in-memory transport port and keyboard creation, editing, stale drafts, reconnect retries, and duplicate receipts. `api/modules/slice-three-browser.integration.test.ts` renders the React workspace in a DOM browser environment and uses the real HTTP Adapter, session checks, Modules, and PostgreSQL for keyboard capture, reload, and editing. Existing Space-management browser tests still pass with the Task workspace mounted.

Review regressions cover families larger than 200, duplicate Archive requests, delayed overview responses, Tag lookup failures, and refreshing an open Task with a Subtask cursor. Large families emit bounded query invalidation rather than a partial Task projection. The browser reloads affected first pages and preserves drafts.

## Following slices

Slice 4 adds relative ordering, movement, Outcomes, close/reopen, WIP warnings, and Task-history views. Slice 5 adds comments and Notifications. Slice 6 connects stored Board updates to live delivery and recovery. Scheduled archive, workflow changes, and permanent deletion remain Slice 7 work. Accessible Task-reference resolution remains with Slice 8 search/reference checks. Public deployment still requires the release gates.
