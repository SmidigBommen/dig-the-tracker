# Slice 8: search, flow, and workload

Members can switch between Board, Search, Flow, and Workload in the current Space. Search and report results open the existing Task dialog. The Board stays in one horizontal row, and dragging is available only in the Board view.

## Search

Search covers Task key, title and description, tags, and current assignee name. Text search matches Unicode words and word beginnings using PostgreSQL's `simple` dictionary. Words match together in Task text, a tag, or an assignee name; comments are excluded. Exact Task keys also use the Space and Task number index. Empty text browses the chosen scope.

Open Tasks are the default. Closed excludes Archived Tasks; Archived and All are explicit options. Results stay inside the authorized Space and use Task-number ordering. Search text is limited to 200 characters, pages default to 50 and cap at 200, and encrypted cursors bind the text, scope, Space, and Board sequence. Old cursors reload the first page.

Task text, tag names, and identity names use GIN indexes. Member and tag links remain relational, so reassignment, tag edits, and current display names participate without copying names into Task search documents.

## Task references

Descriptions and comments link Task keys when the reader can access the target, including Tasks in other Spaces. Missing and inaccessible keys stay plain text. Resolution accepts at most 50 keys per request and returns only Task ID, key, and Space key. The HTTP Adapter authorizes each target Space separately and calls its Board read in a separate transaction, preserving lock order. Search and reports remain confined to the selected Space.

Same-Space links save Task edits before opening the target in the existing dialog. Links to another Space open a new tab, preserving source drafts. Direct paths such as `/spaces/DIG/tasks/DIG-123` survive sign-in and open the target dialog, including accessible archived work. A Task loaded before its live connection becomes ready gains an editor when the connection opens.

## Report definitions

Reports share Board read authorization and the Space, Member, session, Board lock order. All counts include parent Tasks and Subtasks.

- Current WIP counts unarchived Tasks in current Active Columns against their limits.
- Oldest work orders Active Tasks by latest Column entry, with Task ID breaking ties. Age means elapsed time in that Column. Pages default to 50 and cap at 200. Cursors retain PostgreSQL timestamp precision.
- Median Cycle time covers currently Closed Tasks whose latest closure falls in the current Space-local date and preceding 29 dates, including Archived Tasks. It excludes Tasks without a recorded first Active entry. Reopening preserves that first entry, so the eventual Cycle time includes rework. Millisecond precision matches Task detail.
- Weekly throughput covers the current Monday-based week and preceding 11 weeks, using Space-local boundaries. It counts immutable closure events by Outcome. Re-closing work counts another event; later Outcome corrections do not rewrite earlier closure evidence. Only Completed represents delivered work. The current week is partial.
- WIP history shows Active occupancy at each of the last 30 local dates' ends. Today uses the current snapshot. Column IDs preserve history through renaming, role changes, and archive.
- Workload lists current Members alphabetically with their currently assigned, unarchived Active Tasks. It includes an unassigned Active count and exposes no Member throughput or Cycle-time ranking. Each Member starts with at most 10 Tasks, with bounded continuation scoped to that Member.

The UI includes these definitions, accessible tables alongside charts, empty states, and responsive layouts.

## History and runtime

`board_wip_deltas` records changes to Active occupancy within the Task transaction, including family archive, restore, and automatic archive. A Task-table trigger covers the previous runtime during rolling deployment. Composite foreign keys retain Space ownership, and deletion cascades the projection.

The forward migration backfills Active transitions and archive exits from immutable Task events. Restore transitions do not subtract archived work again. It locks Tasks and events across backfill and trigger installation so concurrent writers cannot leave a gap. Historical dates are converted at read time using the current Space time zone, including daylight-saving changes.

Interactive history reads start with current WIP and subtract indexed recent deltas to reconstruct earlier day-end counts. They do not replay lifetime events or load retained Task descriptions. Closure and Cycle-time reads use date-range indexes; oldest and workload pages use indexed per-Column bounds.

`BoardSession` owns the selected view, loading state, query generations, and continuation. Late responses cannot replace a newer search. Committed changes and live snapshot recovery refresh the selected search or report while preserving the search scope and Task drafts.

## Verification

PostgreSQL integration covers Space search scope, authorized reference resolution, comment exclusion, lifecycle filters, stale cursors, reopened Cycle time, WIP family archive and restore, alphabetical workload, precise cursor continuation, DST day/week boundaries, and historical backfill. Browser integration searches and opens Tasks, follows description and comment references, opens a direct link into another Space, then reads Flow and Workload through HTTP and PostgreSQL. Session tests cover delayed live readiness, late search responses, and live refresh; keyboard tests cover opening results and returning to draggable Board work.

A local fixture with 100,000 retained Tasks checks bounded search, Flow, and Workload reads, with a 1.5-second ceiling per read and an indexed search plan. These timings are local checks, not production latency guarantees. Desktop and phone layouts were inspected in Chrome.

## Next slice

Slice 9 completes export and release verification, including supported-browser/accessibility checks, backup restore, load/security gates, and operational readiness. Preserve forward migrations and real production data.
