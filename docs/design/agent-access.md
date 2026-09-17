# Agent access to Dig

Status: product decisions agreed through the 2026-09-16 interview. Slices 11 through 13 implement reads, claims, writes, blockers, and review handoff locally. Slice 14 combined client and extended-absence verification remains open. See [handoff implementation evidence](../implementation/slice-13-agent-handoff.md). [The interview record](agent-access-interview.md) preserves Q1–Q26 and the operator's clarification that agents are not always watching. [Standards research](../research/agent-access-mcp-api.md) separates verified protocol facts from recommendations.

## User outcome

A Member asks Codex to work on a specific Dig Task in the repository already open in their coding session. Codex reads the Task and discussion, claims the work, records relevant progress, and hands back a report for human review. A person decides whether the Task is complete.

The first release serves Members of the current Dig installation through remote MCP and a local Dig skill. Codex desktop is the primary client, with CLI verification and an independent MCP test client. A separately supported HTTP API is deferred. The same domain rules must remain reusable if one is added later.

## On-demand operation

Dig works normally with zero connected agents. Tasks, comments, membership, human notifications, and workflow remain available independently of agent activity. Dig does not run agents, hold their model credentials, schedule coding jobs, or require a Board watcher.

A Task assignment, move, or mention does not start or wake Codex. A person explicitly starts or resumes an Agent run. On the next interaction, the agent reads persisted current Task state and relevant discussion before claiming or changing work. Missed live events cannot be the only record of a decision or permission change.

A Task claim is a temporary reservation, not presence detection. Show its accountable person, connection name, last check-in, and expiry. Do not show an unconditional "agent online" or "agent running" state. If Codex closes or disappears, claims expire without an agent sending a final message. A returning run rechecks the latest assignment, lifecycle, permissions, revisions, and discussion. The same run may resume its still-valid claim after a brief disconnect; an expired, released, or invalidated claim requires fresh acquisition. A new run cannot inherit another run's reservation implicitly.

No background polling process, live agent subscription, automatic dispatch, or external notification service is required in this release. Explicit check-ins during an active run can renew a claim. Their absence must never block normal Board operation beyond the claim's bounded reservation.

## Connection and access

People continue signing in through Dig's existing third-party provider. They create a named Agent connection in a personal Connections screen, choose permitted Spaces, and receive a secret personal access token shown once. A public connection ID identifies the record; only the secret credential authenticates it.

Tokens expire after 30 days and can be revoked immediately. The screen shows name, selected Spaces, creation, expiry, and last-use times. Token replacement uses an explicit setup action rather than silent lifetime extension. Browser sign-in and agent credentials have separate lifecycles. Credentials stay outside skill files and the repository; the server stores only a verifier. Logs, tool results, audit displays, and exports never reveal credential secrets.

A Space administrator enables agent access, initially off, and configures the review destination. Members may grant only their own current rights within explicitly selected enabled Spaces. Joining a new Space does not expand an existing grant. A connection owned by an administrator still has the narrower agent permissions. Disabling agent access or losing membership immediately prevents further access there and invalidates affected claims.

The connection name is an operator-provided label. "Thommy via Codex" attributes the person and named connection; it does not certify which software used the token. Immutable history records stable person, connection, and run attribution rather than relying on the current label alone. Revocation preserves the attribution of earlier work.

Codex supports preconfigured bearer tokens for remote MCP. This first release uses that capability and defers automated MCP OAuth onboarding. Clients requiring that flow are outside the initial compatibility promise. [Official Codex MCP configuration](https://developers.openai.com/codex/mcp).

## Allowed operations

| Operation | Agent behavior |
|---|---|
| Read context | Granted-Space workflow, relevant Member display names and identifiers, Tags, Tasks, comments, and Task history |
| Search | Bounded pages, active work by default, explicit closed/archived inclusion |
| Start existing work | Claim one open, unarchived Task, subject to assignment and access checks |
| Create work | Create a Task and its claim together; new work still enters Intake |
| Create a Subtask | Requires a valid claim on the parent; create and claim the Subtask together; preserve the existing one-level limit |
| Edit a claimed Task | Title, description, and Tags with revision checks; assignment follows the separate start rules |
| Add a comment | Requires that run's valid claim; existing authored comments are not an unrestricted edit surface |
| Move work | Explicit non-Completion destinations with existing order/revision rules and WIP warnings; moves into the configured review Column use the handoff operation |
| Report a blocker | Post explanation, notify the delegating person, and release the claim atomically |
| Hand off for review | Post report, move to the current review Column, notify the delegating person, and release the claim atomically |

Every existing Task requires its own valid claim for agent writes, including comments. A parent claim does not grant control of existing Subtasks. The server enforces claim scope even if the client ignores the skill.

Agents cannot close or reopen Tasks, change closure Outcomes, archive/restore work, moderate or remove comments, alter workflow, manage Members, or administer Spaces. Human actions retain their existing behavior. Full-Space export, administrative audit, Flow/Workload reports, and personal inbox access are deferred. Agent reads never mark human notifications read. Closed and archived Tasks may supply context but cannot be claimed or changed by agents.

Read only relevant pages by default. Content in Tasks and comments is work context, not authority to expand grants, use credentials elsewhere, or automatically follow external links. Pagination, response limits, rate limits, and concurrency bounds apply to agent calls as well as ordinary requests. Enforce budgets per connection and accountable person so adding connections cannot bypass all limits.

## Claim and assignment rules

Only one Agent run may hold a valid claim on a Task at a time. Runs using the same token remain distinct; a second run cannot reuse the first run's authority just by knowing the Task key. Claim operations return authoritative state and clear conflict information.

Claims last two hours from the most recent accepted renewal. The delegating Member and Space administrators can release them immediately. Starting unassigned work assigns it to the delegating Member. Work already assigned to that Member keeps its assignment. If another Member is assigned, the agent stops for a human decision. Agents cannot change assignment through an ordinary edit.

Expiry or manual release leaves the Task and assignment intact. A blocker releases the claim after posting its report; resuming needs a fresh claim. Ordinary human text edits preserve the claim while advancing revisions. Human closure, archive, reassignment, or clearing the assignee invalidates it. Reopened Tasks require a new claim. Token expiry/revocation, membership loss, Space archive, and Space agent disablement invalidate affected authority and visible claims.

A new mutation from an expired or replaced claim must fail, including after reconnect or token replacement. An identical already-committed request may return its stored receipt without acquiring or renewing a claim, provided current credential and Space access checks still pass. Revoked credentials cannot use receipt lookup to regain access. Invalidation takes effect at transaction-time checks; correctness cannot depend on a periodic cleanup job or a connected subscriber.

Dig cannot cancel a separately running Codex process or undo code changes. A disconnected agent might continue local execution after its reservation expires. Claims prevent concurrent valid reservations and stale Dig writes; they cannot guarantee that no external processes perform duplicate coding work.

## Review and interruptions

A Space administrator selects an existing non-Completion Column by stable ID for review. This is a mapping, not a new flow role. Workflows without a suitable Column can add one using existing settings. Changes that invalidate the mapping must select a replacement or disable agent work atomically.

Before handoff, resolve the current review destination and guard against concurrent configuration changes. If no valid destination exists, return a clear configuration error and retain the report in the local session. Do not post a partial handoff or silently choose another Column. Failed handoff leaves the claim unchanged except for normal expiry or independent invalidation.

The report states what changed, verification performed and its outcome, known limitations, and a PR or commit reference when available. Unrun or failed checks must be explicit. Dig stores evidence reported by the agent; it cannot attest to external tests or repository contents. Human review determines whether to close the Task.

On lost connection, preserve local work and pause Dig writes. After an uncertain response, retry with the same request identity rather than duplicating Tasks or comments. A confirmed receipt is required before reporting an update as successful. Refresh state before continuing. Preserve human edits; overlapping edits or a changed work scope require a human decision. Durable retry receipts must prevent duplicate side effects even when the original operation released its claim.

## UX and local skill

Use the existing design system and all personal themes. Add personal Connections management, Space agent settings, and compact Task claim information. Claim details and release actions belong in Task detail; the Board should remain readable when most Tasks have no claim. Expired claims must not look active just because a view missed an event.

Keep machine activity in history without heartbeat comments. Post discussion entries for blockers and review handoffs. Notify the delegating Member in Dig's inbox for those events even though the agent acts for that person. Other Members receive existing explicit mention notifications. Human self-notification rules remain unchanged for ordinary human actions.

The repository ships a local skill and setup instructions. Proposed invocation forms are `$dig show DIG-42` and `$dig work DIG-42`, subject to actual Codex syntax verification. A Task key alone reads context before starting work. The work mode confirms the Task and the repository already selected in the session, then follows the allowed workflow without extra Dig confirmations for each permitted action. The host's own approval policy still applies.

A work request does not independently authorize pushing code, deployment, or Task completion. Repository mappings, automatic checkout selection, and GitHub integration are deferred. The skill supplies guidance; authentication and domain enforcement belong to Dig. [Official skill documentation](https://developers.openai.com/codex/skills).

## Implementation constraints

Keep the modular monolith. MCP is an Adapter over domain behavior, not a second implementation of Board rules. Named tools should express useful operations; they must not publish generic database CRUD or accept caller-supplied identity capabilities.

The current opaque identity and Space capabilities require a browser session. Extend authentication and transaction-time access checks explicitly for Agent connections. Preserve membership/Space checks and lock ordering. Claims, connection grants, review mappings, delegated attribution, and agent notifications need forward migrations. Existing human sessions, receipts, history, and task behavior must remain valid.

Current `board-change` authority is broader than agent policy. Permission checks must distinguish allowed agent operations even when the person is an administrator. Existing notification code and a database constraint both suppress self-notifications, so blocked/ready notifications need explicit new semantics. Agent reads must avoid the current Task-read option that clears human notifications.

Tests exercise the same public Module Interfaces used by HTTP/MCP with real PostgreSQL. Keep typed expected failures, bounded responses, request deduplication, and revision conflicts consistent across Adapters. Use structured results that let a client distinguish denied access, stale revisions, lost claims, invalid review settings, uncertain results, and retryable failures without parsing prose.

## Acceptance evidence

1. With no agent connected, people can create, edit, assign, discuss, and move Tasks normally. None of these actions starts an agent.
2. A Member creates a token through normal Dig login, connects actual Codex desktop/CLI, and reads only explicitly granted enabled Spaces. Expired, revoked, or cross-Space credentials fail safely.
3. Two runs compete for one Task; exactly one claim succeeds. Separate Tasks can be worked independently. Another Member's assignment is preserved.
4. Humans edit a claimed Task without being locked out. Stale agent edits preserve their changes. Reassignment, closure, archive, and access revocation reject later writes and remove active-claim presentation.
5. No agent check-ins occur for more than two hours. The reservation expires through normal reads/checks without needing the missing client to disconnect cleanly. Human work remains available.
6. Codex returns days later after new comments, moves, or reassignment. It reloads persisted context and cannot reuse the stale claim or its old revisions.
7. New Task/Subtask creation and claims commit together. A parent claim cannot edit existing children. Retry identities cannot duplicate work across timeouts or reconnects.
8. A blocker or review handoff commits its report, notification, and claim release together, with the review move included where applicable. Retrying after a lost response returns the committed result without a second report.
9. A review mapping changes or becomes invalid during work. Handoff uses a verified current mapping or returns a recoverable error without partial effects or completion.
10. History identifies both the person and connection/run. Delegated blocked/ready events reach that person's inbox; context reads do not clear it.
11. The skill's show/work paths, recovery, credential replacement, and human review are demonstrated in Codex. An independent MCP client verifies the protocol contract. Pin and document tested client/protocol versions.
12. Keyboard, phone, theme, and accessibility checks cover new controls. Existing human workflows and release checks remain green. Logs and errors expose no credential secrets.

## Delivery and deferred work

[Proposed slices 11–14](agent-access-slices.md) stage connection/read access, claimed work, review handoff, and compatibility/recovery verification. The original Slice 10 production backup and monitoring gates remain separate obligations; agent work does not complete them.

Deferred: a public HTTP API, OAuth connection onboarding, unattended bot identities, hosted agent execution, Board watchers and automatic dispatch, automatic repository selection, GitHub integration, other branded/cloud clients, reports/exports/inbox access, and agent administration or human completion powers. These are explicit scope boundaries, not implied requirements for the first release.
