# Task editing UX

The user selected variant B, the editable Task dialog, on 2026-09-07. Editing was the main source of friction. The card reference uses a compact dark card with its Task key and Assignee avatar above the title and small Tag pills below it.

The three alternatives and their memory-only interactions are preserved on branch `prototype/task-editing-variants`, commit `2a1fd23`. The production implementation keeps only the chosen dialog and compact cards.

## Intended behavior

- Opening an active Task immediately exposes its title, description, Assignee, and Tags for editing. There is no separate Edit Task screen.
- Changes save after a short typing pause. The dialog shows unsaved, saving, and saved states. Closing or navigating to another Task flushes pending edits first.
- Typing during a save is preserved and saved with the next authoritative Task revision. An uncertain request retries with its original ID and content before newer edits are sent.
- Save failures preserve the draft. Revision conflicts show the draft beside the current version and require a deliberate choice. Archived Tasks and Spaces remain read-only.
- Archive and restore live in the Task actions menu. Subtasks use compact rows and open within the same dialog flow. A title input adds Subtasks without a separate creation screen; the Intake column also supports quick Task capture.
- The dialog traps keyboard focus, supports Escape, restores focus on close, and keeps description URLs accessible.

`BoardSession` owns saving and navigation coordination through the existing `BoardTransport` seam. The server command contract is unchanged. Task movement and other Slice 4 behavior remain separate work.

## Verification

The existing BoardSession and browser suites cover automatic editing, overlapping typing, uncertain retries, conflicts, close behavior, archived Tasks, and keyboard capture. The browser-through-HTTP integration test verifies persisted edits with PostgreSQL. All 41 regular tests and 42 PostgreSQL integration tests passed. The integration run used a disposable database in the existing local PostgreSQL instance, which was removed afterward.

Review found and fixed two additional races: reverting to the original value during an uncertain save, and editing the previous Task while the next Task loads. Both have regression coverage. Standards and Spec follow-up reviews reported no remaining findings.
