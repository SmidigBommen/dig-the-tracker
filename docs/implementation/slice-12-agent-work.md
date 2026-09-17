# Slice 12: agent claims and protected work

Implemented locally on 2026-09-17. This slice requires explicit work consent and leaves review handoff, blocker notifications, and human completion to later work. See [the delivery plan](../design/agent-access-slices.md) and [setup](../agent-setup.md).

## Delivered behavior

New connections default to `tasks:read`. Choosing **Allow agent work** creates a `tasks:work` connection for the selected enabled Spaces. Existing tokens keep their permissions through migration and token replacement.

A work session starts a distinct run. Dig returns its public ID and private `runKey`. The start request ID must be a private random UUIDv4 because an exact start retry recovers that key. Keys use a domain-separated HMAC under the existing SESSION_SECRET, bound to the connection and run. They are checked before Board access and excluded from Task reads, receipts, history, and application logs. Server-secret rotation invalidates them. A client that copies another run's public Task metadata cannot use its authority.

One run can claim an open Task for two hours. Claiming unassigned work assigns it to the delegating Member; another person's assignment is preserved. Renewals extend expiry without comments or history entries. Reads filter expired authority without a background process, and browser indicators expire at the earlier claim or token deadline.

Permitted work includes atomic Task creation plus claim, child creation with a parent claim, title/description/Tag edits, comments, and ordinary moves to non-Completion Columns. Every existing child requires its own claim. There is no agent closure, reopen, archive, comment moderation, inbox mutation, workflow administration, or review handoff. The work skill explicitly avoids simulating handoff by moving to a Column named Review.

Humans keep editing. Revision conflicts require agents to refresh context and preserve those changes. The claim owner or Space administrator can release a claim in Task details. Human assignment changes, closure, family archive, and scheduled archive invalidate claims. Reassignment back, restore, or reopening does not revive them. Member removal/re-invitation, policy disable/re-enable, token replacement/revocation, and Space lifecycle changes invalidate the relevant run or grant. Claim release cannot stop an external coding process.

Task cards show a compact claim indicator. Details show the person, connection, effective expiry, last check-in, and release control. Comments and history attribute agent activity to the person via the named connection. Live Board updates refresh indicators after connection or policy invalidation.

## Transactions and recovery

`AgentModule.work` owns run creation and private run authentication. Private Space helpers validate grants, membership generation, policy revision, and Space lifecycle epoch. Board owns claim storage and change authorization. Task-table triggers invalidate claims for all existing human and scheduled lifecycle paths.

Changes lock Space, Member, connection, then Board. Current credential and Space access are checked before looking up a receipt. Request IDs are namespaced by connection and run; command hashes include the claim ID. An exact committed retry returns its original receipt after claim expiry or release. New mutations still require a valid run and matching live claim. Access revocation denies replay as well. A changed retry returns `request-id-reused`.

Board serialization makes competing claims exclusive and Task creation plus claim atomic. Run identity binds connection revision, membership join generation, policy revision, and Space epoch. Public identifiers never substitute for the private run credential. Agent writes use the same SQL timeouts, request budgets, concurrency limits, and serialized response limit as reads.

The migration is additive apart from broadening the connection scope check. It keeps existing Tasks, sessions, and read-only grants. Rollback deletes work connections before restoring the read-only constraint; it never silently converts their permissions.

## MCP tools and local skill

Read-only connections still advertise six read tools. Work connections additionally advertise `dig_start_run`, `dig_claim_task`, `dig_renew_claim`, `dig_release_claim`, `dig_create_task`, `dig_update_task`, `dig_add_comment`, and `dig_move_task`. Schemas reject unsupported fields; a private allowlist also enforces restrictions behind the Adapter.

`$dig show KEY` stays read-only. `$dig work KEY` reads current context, starts a run, claims work, preserves human revisions, renews while active, and releases when pausing. It retains private recovery context and exact pending request IDs across uncertain responses. Local code survives lost authority. Neither the Task nor MCP connection authorizes pushing or deploying code.

Reproduce the opt-in actual Codex work check after building, with a disposable loopback database named `dig_mcp`:

```sh
DIG_MCP_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:PORT/dig_mcp DIG_MCP_WORK_TEST=1 node scripts/test-agent-codex.mjs
```

This uses the installed CLI's login and invokes its configured model. The script creates a temporary Codex home, skill installation, workspace, and local work token. It verifies successful claim, edit, attributed comment, and release through actual MCP calls, then revokes the connection and removes temporary files. It does not mutate production or normal Codex configuration. Omitting DIG_MCP_WORK_TEST retains the Slice 11 read check.

## Verification

Passed locally on 2026-09-17:

| Check | Result |
|---|---|
| Build and lint | Passed |
| Regular suites | 83 tests passed, including idle-browser expiry and renewal |
| Sequential PostgreSQL suites | 124 tests passed |
| Final agent regressions | 23 passed after strengthening existing-token migration and human reopen checks |
| Browser suites | 12 passed across Chromium, Firefox, WebKit, and phone |
| Claim theme/accessibility checks | All three palettes in light/dark; four browser work checks passed |
| Actual Codex CLI 0.154.0 | Read, start run, claim, edit, attributed comment, and release passed using MCP 2025-06-18 |
| Independent MCP client | Work tool schemas, edits, moves, and denied post-closure writes passed |
| Skill validation | Passed; actual CLI invoked the bundled work skill |
| Node 22 production image | Built; liveness/readiness 200 and unauthenticated MCP 401 |
| Backup/restore | 28 tables and 32 rows preserved; upload contract passed |

Database coverage includes competing runs, assignment preservation, parent/child isolation, independent run credentials, retry deduplication, stale human revisions, no heartbeat history, expiry, credential replacement/revocation, Member removal/re-invitation, policy disable/re-enable, Space archive/restore, human release, family archive, and closure/reopen. Browser tests verify live claim visibility, human release, revoked-connection updates in another tab, continued human editing, keyboard use, phone layout, and accessibility.

Standards review: zero unresolved findings. The deleted-Space race during connection revocation was corrected by skipping Boards no longer present after locking.

Specification review: zero unresolved findings. Private run credentials and random recovery IDs prevent public-ID takeover; effective expiry removes badges when a token expires before its claim.

Production reads, claim and assignment, and ordinary Backlog → In Progress → Review movement of COOL-4 were verified through native Codex on 2026-09-17 and confirmed by the user. That movement did not constitute a Slice 13 handoff or send a review notification. [Slice 13](slice-13-agent-handoff.md) adds those operations. Slice 14 extended absence/client checks and Slice 10 off-server backup and monitoring gates remain open.
