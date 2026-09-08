# Slice 4: move work and record flow

Status: implemented on 2026-09-08.

Members can drag Tasks between Columns and relative to cards, or use the keyboard-accessible Move to Column and Position controls in the Task dialog. Closing, reopening, Outcome changes, warnings, and immutable history run through the same Board Interface and PostgreSQL transaction as existing Task changes.

## Delivered behavior

- Relative first, last, before, and after placement uses stable Task IDs. Stored ranks remain private. Column pages use an indexed rank and Task-number cursor; crowded gaps rebalance inside the affected Column.
- Each Column exposes an order revision. Concurrent moves reject stale destination order or stale Task revisions. Capture, archive, restore, and movement advance the affected order revisions. Same-Column reorder preserves flow timestamps.
- Entering Active sets Started at only once. Entering Complete closes with Completed by default. Leaving Complete reopens and clears the current Outcome and Closed at. A later closure measures Cycle time from the original start.
- The dialog offers Completed, Rejected, Cancelled, and Duplicate. Duplicate requires another Task in the same Space, resolved to a stable ID, and its target can be opened from detail. Rejected and Cancelled accept a closing comment of up to 5,000 Unicode characters.
- Changing a Closed Task's Outcome preserves Closed at and Cycle time. The previous Outcome remains in history.
- Exceeding Active WIP and closing a parent with open Subtasks commit with warnings. WIP counts include both parent Tasks and Subtasks. Closing a parent leaves Subtasks open.
- History loads and pages independently of Subtasks. Entries retain actor identity, time, Column snapshots, Outcomes, and closing comments. History updates and Task placements use the authoritative receipt reducer; duplicate sequences are ignored.
- Restoration appends family members to Intake or Complete according to closure state. It records new visible Column entries and preserves prior closure data and first start time. Large families stay in SQL and invalidate bounded browser pages.
- Uncertain movement and Outcome requests retain their original ID and content. After reconnecting, Retry pending change resolves the request before another mutation. Editing stays paused until a successful flow change finishes reloading detail.

## Verification

The slice adds coverage at the agreed `BoardModule`, `BoardSession` transport, and browser/HTTP seams. Database checks include concurrent moves, stale order, dense relative placement, cursor invalidation, idempotent closure, cross-Space Duplicate rejection, transactional rollback, WIP evidence, parent warnings, closure/reopen timing, family restore, and independently paged immutable history.

Browser checks cover keyboard movement and closure through the real HTTP Adapter and PostgreSQL, drag movement, warning display, Duplicate navigation, authoritative reduction, uncertain retries, and preservation of drafts and independently loaded history. The integration browser uses the repository's DOM environment; supported-engine release testing remains Slice 9 work.

`npm run build` and `npm run lint` passed. The full suite with PostgreSQL enabled exercised 98 tests. After correcting an older receipt assertion and the browser movement/reload timing issue, the affected files passed on rerun. This includes the existing 100,000-Task scale fixture.

The standards and spec reviews found a post-move draft-loss race and loss of loaded history during Subtask pagination. Both have regression tests and fixes. Follow-up reviews reported no remaining findings.

## Following work

Slice 5 introduces independent comments, mentions, and Notifications. Closing comments currently live in authored immutable closure history. Connect them to the comment model without losing attribution or creating duplicate history. Slice 6 supplies live delivery and recovery; Slice 7 supplies workflow editing and scheduled archive; Slice 8 supplies flow reports and search. Production browser sign-in and Task editing verification from the deployment handoff remain pending.
