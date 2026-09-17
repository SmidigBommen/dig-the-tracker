# Slice 13: blocker reports and review handoff

Implemented locally on 2026-09-17. Agents can report blocked work or hand a Task to a human for review. Both operations post a report, notify the delegating Member, and release the claim in one transaction. Review handoff also moves to the configured review Column. Humans decide completion.

## Configuration and upgrade

A Space administrator selects an existing non-Completion **Review destination** and enables agent work in **Workflow settings**. The mapping uses a Column ID, never a name. New Columns must be saved before selecting them. Space agent access and explicit `tasks:work` connection consent remain separate requirements. Work tokens include read access; existing read tokens remain read-only.

The forward migration adds Board settings, report origin labels on Comments, and notification attribution/kinds. It starts work disabled and ends existing temporary claims, preserving Tasks, assignments, connections, and read access. After deployment, configure the review destination and enable work before asking an agent to claim a Task. This is a deliberate change from Slice 12's work setup.

Workflow changes must preserve a valid review mapping or disable work in the same save. Disabling work deletes claims atomically. Reenabling allows fresh claims; old claims never revive. These settings do not revoke read access or invalidate run identity. Space access disablement, credential changes, and membership lifecycle still enforce the stricter Slice 12 invalidation rules.

## Operations and presentation

Work connections advertise sixteen MCP tools, including `dig_report_blocker` and `dig_handoff_review`. Read connections retain six tools.

Blocker input names the problem and help needed. Review input includes a change summary, explicit verification outcome and details, known limitations, and an optional PR or commit reference. Verification accepts passed, failed, or not-run; a handoff never certifies success. Both operations accept up to 25 explicit Member mentions. Shared field limits keep formatted reports within the ordinary 5,000-character Comment limit.

Reports appear in Task activity with an agent origin label and normal delegated attribution. The delegating person's inbox distinguishes a blocker from a review request. Other explicitly mentioned Members receive normal mention notifications. Ordinary human self-notifications remain suppressed. Reports use existing Comment editing, edited indicators, removal, and moderation semantics; their text is not an immutable verification certificate. Immutable history records the operation and agent attribution without retaining removed report text.

An ordinary agent move into the configured review Column returns `review-handoff-required`. Completion, inbox access, and workflow administration remain unavailable to agents. No heartbeat comments, background listeners, or always-connected agents are introduced.

## Transactions and recovery

Board owns settings, claims, reports, movement, notifications, and history. Each write locks Space, Member, connection, then Board. It rechecks current credential and Space access before resolving an exact committed receipt. New reports require a valid private run credential, matching live claim, and current Task revision. Review also requires the current workflow revision.

Report validation, review movement, Comment, notifications, claim release, history, receipt, and live update commit together. A late mention-validation failure rolls back movement and order changes as well. Stale Task or workflow revisions preserve the claim and local report for reconciliation. The server reads the mapped destination under the Board lock, so a concurrent configuration save cannot silently redirect a stale handoff.

After a lost response, retry the same request ID and exact arguments first. A committed receipt survives claim release and work disablement while current credential and Space access remain valid. A new operation uses a new ID and requires current authority. Revocation still denies retries. Concurrent exact retries produce one report and notification.

The bundled Dig work skill covers blockers, handoff, configuration failures, reconnects, and honest verification. Overlapping human edits or changed scope require the user's decision. Local work survives lost authority. Task access does not authorize pushing or deploying code.

## Verification

Checks on disposable local PostgreSQL and servers, without production mutations:

- Build and lint passed; 83 regular tests passed.
- All 134 PostgreSQL regression tests passed before adding the final recipient-isolation case. The final Slice 13 suite passed all 11 cases, including that case.
- All 12 browser release checks passed across Chromium, Firefox, WebKit, and phone. All four targeted follow-up checks passed, covering report presentation and review settings in all six palette/mode combinations.
- The independent MCP client accepts maximum-size blocker/review payloads, rejects excess mentions, and replays handoff without duplicating it.
- Actual Codex CLI 0.154.0 invoked the bundled skill using MCP 2025-06-18, read and claimed the Task, edited it, reported a blocker, reclaimed it, and handed it off with not-run verification.
- The Node 22 production image built and returned liveness/readiness 200 and unauthenticated MCP 401. Backup/restore preserved all 28 tables and 95 rows, including report and notification data; the upload contract passed.
- The skill validator passed. Standards and specification reviews identified input-limit mismatches, spacing tokens, and a skill conflict-handling omission; these were corrected.

The opt-in Codex proof uses the installed CLI login, a temporary Codex home/workspace and skill, a disposable work token, and a loopback database named `dig_mcp`:

```sh
DIG_MCP_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:PORT/dig_mcp DIG_MCP_HANDOFF_TEST=1 node scripts/test-agent-codex.mjs
```

Build first. The script revokes its temporary connection and removes local credentials afterward. The older read and claim/edit/release checks remain available through the same script.

Slice 13 production deployment, Slice 14 combined desktop/absence verification, and Slice 10 off-server backup and monitoring activation remain open. Local smoke tests do not close those operational gates.
