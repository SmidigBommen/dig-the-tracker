# Agent access delivery plan

Status: Slices 11 through 13 are implemented locally. Production reads, claim, assignment, and ordinary movement were verified through native Codex on 2026-09-17. Slice 13 deployment and Slice 14 combined client/absence verification remain open. See [Slice 11 evidence](../implementation/slice-11-agent-read-access.md), [Slice 12 evidence](../implementation/slice-12-agent-work.md), and [Slice 13 evidence](../implementation/slice-13-agent-handoff.md). The original Slice 10 operational release gates remain open independently.

Each slice must provide a demonstrable outcome through real Dig authentication, domain behavior, PostgreSQL, and the appropriate browser/MCP client. Forward migrations preserve production data. Keep agent access disabled until a Space administrator explicitly enables it.

## Slice 11: connect Codex and read work

A Member signs in normally, creates a named connection for an enabled Space, configures its token in Codex, and reads a Task with relevant discussion. Revoking the connection stops access. The Board remains fully usable without Codex.

Deliver personal Connections management, Space agent settings, the 30-day token lifecycle, remote MCP authentication, bounded read tools, and the local skill's read mode. Include clear setup and token replacement instructions. Pin a protocol/client combination proven with actual Codex rather than assuming the latest specification is supported.

This first slice exposes read access only. Later write access needs explicit consent; installing a newer release must not silently expand an existing connection's permissions.

Proof: real Codex desktop/CLI reads; an independent MCP client check; expiry/revocation; selected-Space and Member isolation; disabled-Space denial; read pagination; human inbox preservation; no secrets in logs or repository files; theme, keyboard, and phone checks for connection settings. Include an extended period with no agent connected.

## Slice 12: claim and update requested work

A person starts work on a named Task through Codex. Dig assigns unassigned work to that person, grants one run a claim, and accepts permitted edits and progress moves. Another run receives a conflict. People can keep editing or end the reservation.

Deliver run identity, two-hour renewable claims, explicit write grants, create-and-claim for Tasks/Subtasks, claim-scoped edits/comments/movement, delegated history, Task indicators, and human release controls. Extend the local skill to start work, refresh context, recover from disconnects, and preserve human changes. Review handoff remains unavailable until Slice 13; this slice must not simulate it with an ordinary move.

Proof: simultaneous claim races; same-token separate runs; assignment preservation; parent/Subtask isolation; conflict and idempotency tests; immediate effects of human closure/archive/reassignment and access revocation; expiry with no client connected; same-run reconnect versus a new run; ordinary human workflows unchanged.

## Slice 13: report blockers and hand off for review

Codex records a blocker or delivers completed coding work for human review. Dig posts the report, sends the appropriate inbox notification, and releases the claim atomically. Review handoff also moves to the configured review Column. A human decides completion.

Deliver explicit blocker and handoff operations, review mapping validation, delegated-person notifications, report presentation, and the complete skill work mode. Resolve retry receipts before enforcing a still-active claim for an operation that already committed, while retaining current access checks. Workflow settings must preserve a valid mapping or disable agent work.

Proof: transaction rollback prevents partial reports/moves/notifications; a lost response and retry yields one handoff; changing review settings is handled safely; failed/unrun checks appear honestly; delegate notifications work without changing ordinary human self-notification behavior; no heartbeat comments; no agent completion or administration powers.

## Slice 14: verify intermittent use and release compatibility

A Member installs the documented setup, works through a Task, closes Codex, and returns later without losing work or overwriting someone else's changes. The operator has a reproducible release check for the supported clients.

Complete installation and recovery documentation, independent protocol checks, request limits, bounded output/concurrency checks, real-client smoke checks, and browser/accessibility coverage. Verify read/work skill invocation in the supported Codex environments. Publish exact tested versions and capability limits. No extra agent daemon or Board watcher is introduced.

Proof: the end-to-end acceptance scenarios in [the specification](agent-access.md#acceptance-evidence), including days of absence, expired or replaced credentials, invalidated claims, current-context recovery, failure after a committed handoff, and human-only Board use. Existing database, browser, container, and recovery gates remain green.

## Release boundary

Slices 11–13 are incremental demonstrable outcomes; the complete agent feature ships after Slice 14 verifies the combined behavior. Other branded clients, cloud execution, automated OAuth onboarding, public HTTP API access, and background automation remain explicitly deferred.

Choose exact tool names, Module Interfaces, migration structure, rate-limit values, and local credential storage integration during implementation design. Those choices must preserve the accepted behavior and be verified through the public Module and MCP contracts. Return to the feature decision if an actual client limitation requires a different product behavior.
