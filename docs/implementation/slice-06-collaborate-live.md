# Slice 6: collaborate live

Slice 6 connects the existing committed Board updates to open browsers. Task movement, edits, comments, and personal inbox changes arrive without manual refresh. The browser preserves drafts while handling newer revisions and connection failures.

## Delivery

`BoardModule.follow` checks its capability purpose and requested sequence before returning an async iterator. Every delivery rechecks the Space, Member, session, and access revision under the established lock order. Each idle iterator polls once per second through a short transaction and releases its database connection between polls.

Subscribers pull one update at a time. A backlog over 200, a missing update, or a cursor ahead of the Board yields `snapshot-required` and ends the subscription. Writes retain 1,000 recent updates per Space. The PostgreSQL log provides replay across process restarts. No in-memory subscriber queue is required. Membership changes are detected through their persisted access revision; the existing optional invalidation port remains available for a future wakeup optimization.

Personal Notification read-state projections are filtered before delivery. Every subscriber still receives the update's sequence, including when filtering leaves it with no personal changes. Inbox contents are fetched through the recipient-scoped read.

## HTTP and browser behavior

The HTTP Adapter serves authenticated Server-Sent Events at `/api/spaces/:key/board/events`. It rejects foreign Origins and malformed resume sequences, sends a ready event followed by numbered Board events, and disables proxy buffering. Heartbeat comments arrive every ten seconds. A socket blocked for five seconds closes instead of accumulating updates. Deployment shutdown sends `server-draining` before releasing subscriptions.

The framing follows the [WHATWG Server-Sent Events format](https://html.spec.whatwg.org/dev/server-sent-events.html). The browser reads it through fetch, allowing BoardSession to own reconnect timing and snapshot recovery. No bytes for twenty seconds, an ended stream, or a failed HTTP operation pauses editing. Retry delays grow from one to ten seconds. Recovery loads a fresh overview and open pages before establishing another feed. Archived Spaces stay readable; denied access stops automatic retries.

The existing reducer ignores duplicate or older sequences. Incoming updates refresh loaded pages. Clean Task fields follow current data; unsaved Task and comment drafts remain beside newer versions. An archived Task's retained draft becomes read-only. Pending requests keep their IDs for explicit retry, including when a save response was lost while the event stream remained available. Leaving the Board cancels its stream and timers.

## Verification

Tests exercise the BoardModule, owned HTTP Adapter, BoardSession transport port, and browser view with PostgreSQL. They cover replay, gaps, slow readers, session revocation, Space archive, recipient privacy, consumer cancellation, HTTP authentication and framing, deployment drain, and 100 simultaneous authenticated HTTP connections. Browser checks cover live movement and comments from a second session, reconnect, and retained drafts. Session regressions cover duplicate and abandoned-feed events, clean-field refresh, stale drafts, isolated HTTP failures, and Task archive during editing.

## Next slice

Slice 7 adds workflow configuration and scheduled retention. New workflow and lifecycle changes must reach already-open browsers and preserve the existing feed sequence, access checks, and snapshot behavior.
