# Slice 7: workflow and retention

Administrators can edit the complete ordered workflow in one save, including Column names, flow roles, WIP limits, Intake, archive, and restore. Workflow settings uses the shared dialog and controls. Members see committed changes through the existing live feed.

## Workflow rules

`set-workflow` rechecks current administrator membership under the established Space, Member, session, and Board lock order. It validates the final plan before writing. Names contain 1 to 60 Unicode characters. Exactly one Queue Column is Intake and exactly one Column is Complete. Active Columns require a positive integer WIP limit. Existing IDs preserve identity, and new Columns receive server IDs in the receipt's workflow projection.

Changing a Column's role or Intake status, or omitting it to archive it, requires no unarchived Tasks in that Column. Reordering and renaming populated Columns remain allowed. Intake and Completion can be replaced in one transaction. Archived Columns keep their IDs and transition history. Restoration uses their previous non-terminal role and WIP limit and starts empty. Workflow reads include archived Columns. Each Board can retain at most 200 Columns in total, bounding settings and feed payloads.

The workflow revision rejects stale plans. Role, terminal status, WIP limit, archive, and restore changes also advance the destination order revision, rejecting moves prepared against the old settings. Request receipts make retry safe. Browser drafts retain their original revision while live changes update the Board; an explicit reload replaces the draft even if the revision is unchanged. A lost save response preserves the request ID for retry. Workflow changes append a Space audit action and a committed Board update.

## Scheduled archive

The runtime runs maintenance on startup and every minute, with no overlapping runs in one process. Each pass visits at most 20 Spaces with due Tasks and selects at most 100 due Tasks per Space. Archiving a selected parent includes its full Subtask family in the same transaction. Competing processes serialize on the Board lock and recheck eligibility.

A Closed Task becomes eligible at midnight on the Space-local date 30 dates after closure. PostgreSQL calculates local dates with the Space's IANA time zone, including daylight-saving changes. Restoring a Closed Task starts another 30-local-day window while preserving its original Closed at, Outcome, and Cycle time. Archived or deletion-scheduled Spaces receive no automatic Task changes.

Automatic archive adds history attributed to Dig, with a null Member ID, and advances the Board sequence. Small families project affected IDs directly; larger families invalidate the bounded pages for snapshot recovery. Comments and earlier history remain intact. Existing family restore places open Tasks in Intake and Closed Tasks in Complete.

## Permanent Space deletion

The deletion runner locks and rechecks due Spaces after the existing seven-day cancellation period. Cancellation at or after the deadline is rejected. Cancellation and deletion serialize on the Space row, so only one wins.

Space-owned data and request receipts cascade with the Space. Forward migration scopes historical Space receipts using their stored Space, Member, or invitation result. A compatibility trigger scopes receipts written by the previous runtime during a rolling deployment. The key reservation remains with its identity reference cleared, preventing key reuse without retaining a personal association. Identities with no remaining membership lose their browser sessions; configured installation administrators retain installation access.

The worker has no browser endpoint. Shutdown stops scheduling and waits for the active pass before closing PostgreSQL. Errors are logged without database details or personal data and retried on the next minute.

## Verification

Module and runtime integration tests cover workflow receipts, administrator denial, stale revisions, empty-Column rules, atomic terminal replacement, previous-role restoration, local-date boundaries across spring and autumn daylight-saving changes, family archive/restore, competing archive passes, restored retention, deletion deadlines, cancellation, and permanent key reservations. Browser integration exercises settings through HTTP/PostgreSQL and verifies live delivery to another BoardSession. Session tests cover uncertain saves and draft baselines. Desktop and phone layouts were inspected in Chrome.

## Next slice

Slice 8 adds Space search and flow/workload evidence. Preserve workflow identities, immutable history, local-date semantics, bounded pages, and recipient privacy. Automatic history actors have no Member ID and must remain distinguishable from people in reports.
