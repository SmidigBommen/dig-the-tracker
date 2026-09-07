# Team MVP vertical-slice plan

Status: Slices 1 through 3 implemented. Slices 4 through 9 remain planned.

## Delivery rule

Each slice must produce one demonstrable user outcome through the real browser, owned HTTP Adapter, Module Interface, and PostgreSQL Implementation. It also adds tests at the narrowest useful Seam. A slice is not complete when only tables, generic helpers, or disconnected UI exist.

The current prototype remains reference material, not a compatibility target. Slice 1 preserves its tables and files temporarily while moving the running browser and HTTP paths to the team model. Slice 3 removed that retained path after its capture and editing behavior gained replacement tests.

Public team deployment remains disabled until the release slice passes all gates. Earlier slices are locally runnable and integration-tested.

## Slice sequence

| Slice | Demonstrable outcome | Main Module work | Required proof |
|---|---|---|---|
| 1. Sign in and open a Space. Complete | An installation administrator signs in, creates a Space, sees its unnamed Board with Backlog, In Progress (WIP 3), and Done, reloads, and signs out. | Establish the team schema; implement the OpenID Connect port and mock/production Adapters, PostgreSQL sessions, `IdentityModule`, Space creation and switcher in `SpaceModule`, default Board creation, secure HTTP Adapter, and the smallest `BoardModule.read(overview)`. | Passed: signed-token verification, state/nonce/PKCE, five-day idle and 30-day absolute session limits, CSRF/Origin checks, anonymous denial, installation-administrator creation, idempotent atomic Space/default-Board creation, HTTP flow, and browser shell. |
| 2. Invite a teammate safely. Complete | An administrator issues an invitation; a second authenticated person accepts it and can open the Space; role change, leave, removal, archive, and restore obey their rules. | Complete invitations, membership, roles, Space lifecycle, administrative audit, opaque `AuthorizedSpace`, access revisions, private transaction recheck, and stream invalidation hook. | Passed: invitation expiry/replay/concealment, last-administrator and cross-Space denial, access races with Member removal and archive, former-Member audit attribution, session effects, opaque paging, HTTP flows, and browser management. |
| 3. Capture and shape work. Complete | Members create, open, edit, assign, tag, archive, and restore Tasks and one-level Subtasks through bounded pages. | Implement the first `BoardModule.change` commands, task revisions and numbering, Intake placement, tags, assignment, task detail, cursor pages, and the browser `BoardSession` with an HTTP `BoardTransport` Adapter. | Passed: concurrent Task-number test; input limits; Subtask-depth rule; stable-ID and cross-Space constraints; stale edit presentation; 100,000-Task page query check; keyboard/browser tests for create and edit. |
| 4. Move work and record flow | Members drag or explicitly move Tasks, see WIP warnings, close with an Outcome, reopen, and inspect immutable Task history. | Add relative placement and order revisions, Completion behavior, Outcomes, transition/closure history, warning calculation, and authoritative `BoardUpdate` reduction. The retired prototype no longer exposes Priority or literal-column-name behavior. | Concurrent move and stale-order tests; warning-but-allow tests; open-Subtask warning; duplicate-target validation; close/reopen/Outcome-history tests; keyboard `Move to Column` test. |
| 5. Discuss and notify | Members comment, edit their own comments, mention teammates, moderate as administrators, and work through the in-app inbox. | Add comment revisions/tombstones, mention bindings, moderation audit, Notification creation, read state, 90-day expiry, inbox paging, and task-open read behavior. | Author/moderator permission tests; same-Space mention tests; self-notification suppression; assignment/mention/assigned-Task comment cases; atomic state/history/Notification/update tests. |
| 6. Collaborate live | Two open browsers see committed Board changes within seconds, recover after a missed sequence, and become safely read-only while disconnected. | Implement `BoardModule.follow`, retained sequences, bounded subscriber buffers, Server-Sent Events Adapter, reconnect/snapshot recovery, heartbeat access checks, and server-draining closure. | Duplicate/out-of-order reducer tests; missed-sequence snapshot test; revocation/archive stream closure; slow-subscriber behavior; disconnect/reconnect browser test; 100-connection check. |
| 7. Adapt and retain the workflow | Administrators atomically edit the workflow; Members browse Archive; Closed Tasks auto-archive after 30 Space-local days; Space deletion observes its grace period. | Complete declarative `set-workflow`, Column archive/restore, Task-family archive/restore, scheduled archive runner, deletion runner, and private cross-Module lifecycle effects. | Empty-Column and terminal-role invariants; atomic Intake/Completion replacement; DST and Space-time-zone archive tests; parent/Subtask archive tests; deletion cancellation and permanent key-reservation tests. |
| 8. See flow and bottleneck evidence | Members search their Space and view WIP, age, oldest work, median Cycle time, weekly throughput by Outcome, WIP history, and current workload without ranking people. | Implement search, flow and workload reads, indexed history queries or maintained summaries, report pagination, and accessible responsive views. | Search-scope and inaccessible-reference tests; report-definition fixtures; reopened-work Cycle-time tests; no Member ranking; query plans and load checks at the accepted scale. |
| 9. Release on the Hetzner server | The same OCI image runs locally with Compose and in Coolify, exports a Space, survives graceful shutdown, exposes health state, and has a tested backup restore. | Finish versioned JSON export, container/runtime assembly, checksummed migration runner and lock, readiness/liveness, structured redacted logging, graceful drain, Coolify configuration, backup/restore instructions, and monitoring hooks. | Export privacy/schema tests; clean-database setup; image and Compose smoke tests; supported-browser and WCAG gates; load/security gates; Coolify deployment rehearsal; documented successful restore within the recovery target. |

## Interface-test progression

Tests accumulate at stable Seams, not at replaced internals:

1. `IdentityModule` and `SpaceModule` behavior tests use isolated PostgreSQL and the mock OpenID Connect Adapter.
2. `BoardModule` behavior tests call `read`, `change`, and `follow` with capabilities obtained through the upstream Modules.
3. HTTP Adapter tests verify parsing, cookies, CSRF, safe fault mapping, and serialization without duplicating Board invariants.
4. `BoardSession` tests use an in-memory `BoardTransport` Adapter and exercise the same `BoardUpdate` reducer used with HTTP and Server-Sent Events.
5. A small end-to-end suite proves the cross-Seam user outcomes for each completed slice.

Old `AppService`, `Repository`, `TaskContext`, and route-level behavior tests are removed only when the replacing Interface and outcome tests pass. Do not keep parallel mutation paths after cutover.

## Schema strategy for the clean-slate MVP

The first implementation slice establishes a new schema for the selected Modules. The existing database contains no retained value and receives no compatibility migration. During pre-release development, schema changes may be rebuilt from empty and the baseline may be consolidated. Once real team data is admitted, every later change uses forward checksummed migrations and the normal startup migration lock.

Every Space-owned table includes `space_id`; composite constraints prevent cross-Space relationships. Stable opaque IDs own relationships. Human Space keys, Task numbers, display names, slugs, and Column names never do.

## Proposed source arrangement

This is a planning map, not a requirement to preserve today's file layout:

```text
api/
├── modules/
│   ├── identity/       Interface and hidden Implementation
│   ├── space/          Interface and hidden Implementation
│   └── board/          Interface and hidden Implementation
├── adapters/
│   ├── http/           routes, cookies, CSRF, serialization, SSE
│   └── oidc/           production OpenID Connect Adapter
└── runtime/            assembly, migration, health, drain, scheduled work

src/
├── board-session/      browser Module and BoardTransport port
├── adapters/http/      HTTP and Server-Sent Events BoardTransport Adapter
└── views/              React intent and rendering
```

Shared contract source should contain only wire-safe values needed by both owned Adapters. Opaque server capabilities, PostgreSQL records, locks, secrets, and provider claims stay out of it.

## Next implementation action

Start Slice 4 with relative placement through `BoardModule.change` and a keyboard Move action. Preserve Task revisions, request receipts, transaction-time access checks, and atomic Task events/Board updates. Add order revisions, closure and Outcomes, warnings, and history views through separate red-green cycles. Board-owned unassignment already runs in the Space membership transaction.
