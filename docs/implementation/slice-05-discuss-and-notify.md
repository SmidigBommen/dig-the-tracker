# Slice 5: discuss and notify

Slice 5 implements comments and the in-app inbox through the browser, owned HTTP Adapter, `BoardModule`, and PostgreSQL.

## Delivered behavior

Members post plain-text comments with preserved line breaks and safe URL links, select and follow mention links by stable Member ID, and edit their own comments. Edits show a marker. Authors and Space administrators can remove comments, leaving an attributed tombstone. Administrator removal of another Member's comment records both Task history and Space audit. Archived Tasks reject comment changes.

Comments have independent revisions and bounded pages. They do not advance Task or Column order revisions. Stale comments return the current text for comparison with the browser draft. Drafts survive Task navigation, and uncertain requests retain the original request ID for retry.

The inbox covers new assignments, mentions, and comments on assigned Tasks. A mention takes precedence when the recipient is also the Assignee. Editing notifies only newly added mentions. Self-notifications are suppressed. Only current same-Space Members can be newly mentioned; existing attribution survives membership removal.

Notifications become read individually, through mark-all-read, or when the recipient opens the Task. Task opening sends `markNotificationsRead: true` and affects only that recipient. Task reference lookups and page loads leave read state unchanged. Notifications expire after 90 days and disappear from reads and counts immediately; inbox reads also delete expired rows for that recipient. Inbox pages default to 50 and cap at 200.

## Transactions and migration

Comment state, mention bindings, Notifications, history, moderation audit, request receipts, and Board updates commit together. The existing Space, Member, session, then Board lock order remains intact. Inbox revisions use separate Board-owned rows to avoid upgrading a membership lock after another request has started waiting for the Board.

Four forward migrations add comments, moderation audit action support, mentions and Notifications, then closure-comment links. Existing closing comments migrate with their original author and time. New closure comments follow the same path as ordinary comments and can notify the Assignee. Closure history keeps its original event identity, timestamp, and Outcome; displayed comment text follows edits or removal through the link.

Personal inbox contents stay out of shared Board updates. Read-state projections identify the Member and carry bounded selection criteria. Slice 6 must filter these before feed delivery and reload personal inbox pages after invalidation.

## Verification

Module tests cover author and administrator permissions, stale revisions, tombstones and audit, same-Space and former-Member rules, idempotency, Notification reasons and suppression, task-open read scope, expiry and cursor isolation, closure-comment continuity, concurrent mentions, and rollback on receipt failure followed by idempotent retry. BoardSession tests cover retained drafts, uncertain retries, personal projection filtering, and stale-comment comparison. Browser tests cover mention selection, former-Member mention removal, inbox navigation, and keyboard comment creation, editing, and removal through real HTTP and PostgreSQL.

Final validation passed 115 tests across 19 suites with PostgreSQL integration enabled, plus `npm run build` and `npm run lint`. Standards and spec reviews found no remaining issues after fixes.

## Next slice

Slice 6 adds `BoardModule.follow`, retained sequence delivery, Server-Sent Events, snapshot recovery, access-change closure, bounded subscribers, and browser reconnection. The current browser requires explicit refresh to see another Member's changes.
