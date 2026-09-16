# Agent access interview record

Status: discovery interview started on 2026-09-16. Q1 through Q26 accepted. The operator also explicitly requires normal operation when no agent is watching the Board. This file preserves the interview; current implementation status is in [the delivery plan](agent-access-slices.md).

## Request

Enable agents to work with Dig through MCP, an HTTP API, or both. Interview the operator, document the decisions and their tradeoffs, then agree on a feature set before implementation.

The original [MVP checkpoint](team-kanban-checkpoint.md#architecture-and-deployment) deliberately kept the JSON API private and excluded API tokens, bots, and integrations beyond OIDC. This proposal is a new extension. Existing release gates remain separate work.

## Existing implementation

- `IdentityModule` authenticates people through OIDC and browser sessions. Agent credentials and service identities are not implemented.
- `SpaceModule` authorizes Space access. `BoardModule` rechecks access inside its transactions.
- Board reads already cover task context, search, workflow, comments, history, flow, and workload. Changes already express task capture, editing, placement, closure, comments, and other domain actions.
- Changes use request receipts to handle retries and revisions to detect conflicts. The live feed supports recovery from missed updates.
- Task history currently attributes changes to Members. How delegated software appears in that history is an open product decision.

These are reuse candidates, not a decision to publish the browser API unchanged. See [the architecture](../../ARCHITECTURE.md) and the running Module Interfaces under `api/modules/`.

## Decision tree

The interview proceeds in rounds. Questions in a round have no unanswered prerequisites. Later questions depend on the answers and may change.

| Branch | First decision | Decisions it unlocks |
|---|---|---|
| Useful work | First end-to-end agent workflow | Required reads and writes, context size, completion evidence, acceptance scenarios |
| Clients | Actual tools and environments that must connect | MCP/API delivery, local or remote transport, client compatibility, connection UX |
| Execution | External agents connecting to Dig, or Dig launching agents | Deployment responsibility, job lifecycle, scheduling, retries, operational scope |
| Audience | Personal use, Members of this installation, or external consumers | Delegation and service identities, credential ownership, onboarding, compatibility commitments |

After these roots, examine permissions and attribution, human review, concurrent agents and work claims, stale edits and retries, notifications and events, data boundaries, abuse limits, credential revocation, audit visibility, and rollout. Each branch must be resolved or explicitly deferred with a reason before the design is considered agreed.

## Round 1: accepted direction

### Q1. First useful workflow

What should an agent accomplish end to end in the first release?

Accepted: a coding assistant reads a selected Task and its discussion, updates progress, posts a result with evidence, and moves the Task to a configured review stage. A human decides whether the work is complete. Dig currently has no universal Review role, so destination selection needs a later decision.

Read-only planning, summaries, and automated triage are not the first workflow. Individual supporting operations still need decisions.

### Q2. First clients

Which exact tools and environments should connect on day one? Examples are the current coding assistant, a chat assistant, or a script/CI job. Name the primary client and any mandatory second client.

Accepted: Codex is the primary client. Verify one independent client before claiming portability. Desktop is the primary environment, with CLI verification. The independent secondary client remains open. Protocol and authentication choices follow verified client requirements.

### Q3. Who runs the agent?

Should an existing external agent connect to Dig, or should assigning work in Dig start an agent that Dig operates?

Accepted: external agents connect to Dig in the first release. Dig provides work context and records changes. Agent execution, model credentials, sandboxes, and job scheduling remain with the external tool.

### Q4. Intended audience

Is this for the operator alone, for Members of this Dig installation, or for third parties building integrations for other installations?

Accepted: Members of the current installation, with reusable code and documentation. Public integration distribution and ecosystem support are deferred.

## Round 2: accepted direction

### Q5. Identity and attribution

Does Codex act on behalf of its human user, or as a separate bot Member?

Accepted: delegated access for the signed-in person, visibly attributed as that person via the named connection, for example `Thommy via Codex`. Retain both the accountable person and connection identity in history. Separate unattended bot identities are deferred.

### Q6. Space access

Does a connection gain access to every Space the person can access, or only selected Spaces?

Accepted: explicit Space selection for each connection, excluding future Spaces until granted. Current membership and granted permissions both constrain access; losing membership removes access even if a grant remains.

### Q7. Allowed changes

Which task operations may the agent perform within the approved scope?

Accepted: read/search, create Tasks and Subtasks, edit task fields, add comments, and move work through progress and review. Completion remains a human decision as accepted in Q1. Agent task archive/removal, comment moderation, workflow edits, membership changes, and Space administration are excluded initially. Exact assignment and per-run approval rules follow after this boundary is chosen.

### Q8. Codex environment

Is the primary setup the Codex desktop app, terminal CLI, IDE extension, cloud tasks, or several of these?

Accepted: the current desktop workflow as the primary acceptance environment, plus CLI verification. The CLI installed on this Mac is 0.154.0 and exposes remote MCP URL, bearer-token, and OAuth-login options. This does not prove compatibility with a Dig server or every Codex environment.

### Q9. Repository context

Should Dig maintain a repository mapping for each Space or Task, or should Codex work in the repository already selected in the user's coding session?

Accepted: use the explicitly selected repository in the Codex session and an explicit Dig Task key. Before writing code, show the Task and repository being used. Repository mappings and automatic checkout selection are deferred.

## Local skill

The operator is willing to connect Dig through a local skill backed by MCP or an HTTP API. A proposed Dig skill guides the workflow: resolve a Task key, read context, confirm the repository, perform the requested work, report verification, and hand back for review. Dig enforces credentials, permissions, revisions, retry semantics, and attribution on the server. Skill instructions do not grant permission or replace server checks.

Codex skills can package instructions and supporting scripts. MCP supplies discoverable tools over a supported connection. An API-backed skill is also a possible design, using a small client rather than browser cookies. [Official skills documentation](https://developers.openai.com/codex/skills), [official MCP documentation](https://developers.openai.com/codex/mcp).

The exact skill packaging and command names are undecided. Q10 selects remote MCP for the first release and defers a separately supported HTTP API.

## Round 3: accepted direction

### Q10. Initial delivery

Should the first release provide remote MCP with a local skill, a documented HTTP API with a skill/client, or both?

Accepted: remote MCP plus a small local Dig skill for the accepted Codex workflow. Reuse Dig's domain operations; defer a separately supported public HTTP API until scripts or another consumer require it. MCP itself uses HTTP remotely, but that does not create a general-purpose HTTP API contract.

### Q11. Who permits agent access?

May every Member grant a connection access independently, or must a Space administrator first enable agent access for the Space?

Accepted: Space administrators enable agent access, initially off. Members then connect their own accounts and select from permitted Spaces. Each grant stays within that Member's current rights and the agent-specific restrictions. Revoking Space enablement disables all agent access there.

### Q12. Approval during work

After the user explicitly asks Codex to work on a Task, should allowed progress changes require further Dig approvals?

Accepted: allow in-scope edits, comments, and progress/review moves during that requested work without a Dig confirmation for each operation. Human completion remains required. Client approval policies still apply independently. The skill preserves the requested Task scope; server permission checks remain mandatory on every call.

### Q13. Concurrent agents

What happens when two agent sessions try to work on the same Task?

Accepted: one active agent claim per Task, visible in Dig. A second agent gets a conflict instead of silently duplicating work. Claims expire or can be released by a person. Humans can still edit; revision conflicts preserve their changes. Claim duration, renewal, takeover authority, and interrupted-session recovery depend on accepting this feature.

### Q14. Review destination

How should the agent know which Column means ready for human review?

Accepted: a Space administrator chooses an existing non-Completion Column by stable ID as the review destination. Setup must identify a valid destination before enabling the complete agent workflow. Existing workflows without Review can add a Column through normal workflow settings. This mapping adds no new flow role and agents cannot modify it.

### Q15. Assignment

May Codex automatically assign the Task to the person it acts for, and may it take work assigned to someone else?

Accepted: assign unassigned work to the delegating person when starting it. Keep existing assignment to that person. If another Member owns it, stop for a human decision instead of reassigning automatically. Changing another Member's assignment remains outside automatic agent behavior. Exact enforcement follows the approval and claim decisions.

## Round 4: accepted direction

### Q16. Connecting and disconnecting

Accepted after clarification. The operator preferred an ID-based credential alongside existing third-party login.

The earlier browser authorization proposal would reuse Dig's existing third-party sign-in to identify the person, then authorize Codex separately. It would not introduce a second human account or Dig password. However, a manually provisioned personal access token is another way to authenticate the external client.

Accepted: use named personal access tokens for the first release. The person signs into Dig normally, opens Connections, creates a connection, selects administrator-enabled Spaces, and receives a secret token shown once. Codex supplies that token to the remote MCP endpoint. A public connection ID identifies the connection for management; the unpredictable secret token proves access. An account ID or Space key alone grants no access.

The Connections screen shows the connection name, granted Spaces, creation/expiry/last-use times, and immediate Revoke. Store only a verifier for the secret on the server. Store the actual credential locally outside skill files and the repository. Keep current membership, Space enablement, and allowed operations enforced on every request. The token has its own expiry and revocation, separate from the browser sign-in session. Tokens expire after 30 days and require replacement rather than OAuth renewal.

Codex supports configured bearer tokens for remote MCP. This option defers automated MCP OAuth onboarding; it does not promise compatibility with clients that require that flow. It also does not require publishing a separate HTTP API. [Official Codex MCP configuration](https://developers.openai.com/codex/mcp).

### Q17. Abandoned work and takeover

How long should a Task remain claimed if Codex is disconnected or closed, and who can release it?

Accepted: a two-hour claim, renewed by explicit agent check-ins during work. Show last check-in and claim expiry rather than claiming the agent is running continuously. The delegating Member and Space administrators can release it immediately. Releasing or expiring a claim leaves the Task, assignment, and code untouched. A stale agent must reacquire a valid claim before writing; it cannot overwrite a replacement claim. Reconnecting reads current state before resuming. Renewal cadence is guidance for the client, not a guarantee that Dig can observe local execution.

### Q18. Conflicts and unavailable Dig

Should an agent continue changing Dig when it loses its connection or discovers newer human edits?

Accepted: preserve local work, pause Dig writes, and report the interruption. Retry an uncertain request with its original identity so it cannot duplicate a Task or comment. Refresh Task state before continuing. Preserve human changes; if they alter the requested scope or overlap an intended edit, ask the human how to proceed. Never claim a progress update or review handoff succeeded without a confirmed receipt.

### Q19. Review handoff

What information must Codex supply before moving work to the review Column?

Accepted: a concise result with what changed, verification performed and its outcome, known limitations, and a PR/commit reference when one exists. Identify unrun or failed checks honestly; Dig stores the report but cannot prove that external code or tests match it. The report, review move, claim release, and handoff notification should commit together. Human review decides whether the work is acceptable; no GitHub integration or automatic push/merge is included.

### Q20. Activity and notifications

How much agent activity should appear in the Board, discussion, and inbox?

Accepted: a compact claim indicator on the Task showing the connection and accountable person, with activity details in Task history. Add discussion updates for a blocker and final review handoff; avoid periodic progress chatter and heartbeat comments. Notify the delegating person in Dig's inbox when the agent is blocked or ready for review, even though the action is delegated under that person's identity. Other Members receive existing explicit mention notifications. No external notifications are added.

### Q21. Local skill interaction

Should invoking the skill only show context, or immediately start making progress changes?

Accepted: explicit modes, provisionally `$dig show DIG-42` for reading and `$dig work DIG-42` for the accepted coding workflow. A Task key alone shows context and asks before beginning work. A work request authorizes the allowed in-scope progress actions from Q12 after confirming the selected Task and repository; it does not authorize completion, pushing code, or deployment. Installation instructions and the skill ship with the repository. Exact syntax remains subject to actual Codex behavior.

## Round 5: accepted direction

### Q22. Human overrides and invalidated access

What happens when a person closes, archives, or reassigns a claimed Task, revokes the connection, or disables agent access?

Accepted: immediately invalidate affected claims and reject further agent writes. Task reassignment includes clearing the assignee, so work cannot continue under stale ownership. Ordinary human text edits retain the claim but require the existing revision/conflict behavior. A Task reopened by a person needs a fresh claim. Token expiry, membership loss, and Space archive also invalidate access and claims. Show the claim as ended rather than leaving an active badge behind. Dig can stop access to Dig; it cannot terminate a separately running Codex process or undo its local code edits.

### Q23. Review configuration changes during work

Should handoff use the original review Column, the current setting, or ask the human if the setting changed?

Accepted: read the current administrator-selected destination before handoff and use that setting, guarded against a concurrent configuration change. If no valid destination exists, preserve the handoff draft locally and return a clear configuration error; do not post a partial handoff, silently pick a Column, or complete the Task. Workflow edits that invalidate the mapping must choose a replacement or disable agent work atomically.

### Q24. Enforce claim scope on the server

May a run with a claim on one Task update other Tasks or existing Subtasks?

Accepted: each existing Task requires its own valid run claim for all agent writes, including comments, blockers, and handoff. A parent claim grants no automatic authority over existing Subtasks. Agents can create a Task in an enabled Space and atomically claim it for that run; creating a Subtask also requires a claim on its parent. Every claim follows the assignment rules. Agents cannot later change the assignee through a general task edit. A blocker report posts its explanation, notifies the delegating person, and releases that Task's claim atomically; resume requires a fresh claim. Server checks enforce these rules even if a client ignores the skill.

### Q25. Read context and excluded data

What may the agent read beyond the selected Task?

Accepted: granted-Space workflow, Member display names and IDs needed for assignment/mentions, Tags, bounded Task search/detail, parent/Subtask context, comments, and Task history. Search active work by default with explicit closed/archived inclusion. Archived Tasks are readable context but cannot be claimed or changed. Fetch only relevant pages by default. Defer Flow/Workload reports, full-Space exports, administrative audit, and the person's private inbox. Agent reads never mark human notifications read. Task text supplies work context, not permission to expand access or follow arbitrary external links.

### Q26. First-release compatibility promise

Should the first release wait for additional named agent products beyond Codex?

Accepted: require successful Codex desktop and CLI tests plus an independent MCP test-client check of discovery, authentication, typed inputs/results, errors, and retries. Advertise Codex support only; defer other branded clients and cloud environments until explicitly tested. Publish the tested client and protocol versions, setup instructions, and token replacement/revocation behavior. Do not claim universal MCP compatibility from one client's success.

## Decision record

The operator accepted Round 1 recommendations, named Codex as the primary client, offered to connect a local skill through MCP or an API, and accepted Round 2 and Round 3 recommendations. In Round 4 the operator accepted Q17 through Q21 and reopened Q16, suggesting an ID-based credential rather than a second browser authorization flow. The operator then accepted the revised Q16 recommendation of named personal access tokens with a 30-day lifetime. Local skill integration is in scope for the design. The operator accepted Round 5 recommendations and clarified that agents are not always listening or watching. Agent access must work on demand, including after an extended absence. The consolidated feature specification is in [Agent access to Dig](agent-access.md). This interview records accepted product choices, not a request to implement the feature.

## Research

[MCP and API research](../research/agent-access-mcp-api.md) records primary-source findings separately from recommendations. It includes official Codex documentation and local CLI verification. The supported protocol revision must be verified with the selected client; the newest specification alone is not evidence of client compatibility.

### Implementation constraints found in the current code

- Authentication capabilities and Board transaction checks currently require a browser session. A delegated credential needs an explicit authentication path with transaction-time connection, grant, membership, and Space-policy checks. Reusing a browser cookie as an agent credential would not implement these requirements.
- `board-change` currently permits more than the accepted agent policy, including closure and some administrator actions. Narrow agent permissions must be enforced even when the delegating person is an administrator.
- History and comments record a Member but no connection or run. Request receipts share a Space/Member/request-ID namespace. Delegated attribution and retry identity need an explicit design that preserves existing records.
- Both notification code and a database constraint suppress self-notifications. The proposed blocked/ready notifications to the delegating person need a forward migration and explicit agent-event semantics; changing only the UI would not work.
- Task reads can mark human notifications read. Agent context reads must preserve the person's inbox. Task claims and review-Column mappings are new state, not existing capabilities.

Sources: `api/modules/private-capabilities.ts`, `api/modules/identity/identity-module.ts`, `api/modules/board/private-access.ts`, `api/modules/board/private-notifications.ts`, and `db/migrations/202609080005_mentions_notifications.sql`.

## Final clarification: agents are intermittent

The operator stated that agents will not always listen to or watch the Board. Dig remains usable with zero connected agents. A Task assignment, move, or mention does not launch or wake Codex. A person starts or resumes work explicitly. The next agent interaction reads persisted current state and relevant discussion before obtaining a claim or writing. Claims expire without a watcher; the UI describes reservations and last check-ins, not live presence. Live subscriptions, background polling workers, and automatic dispatch are outside the first release.
