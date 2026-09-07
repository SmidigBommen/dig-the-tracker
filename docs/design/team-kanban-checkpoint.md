# Small-team kanban design checkpoint

Status: shared understanding confirmed by the user on 2026-09-04 after Q102. Slices 1 through 3 are implemented; later slices remain planned.

## Product direction

Dig is a simple, flow-based kanban system for a small team. It helps the team capture work, coordinate ownership, see where work waits, and expose bottlenecks. It does not encode Scrum or another named method.

The first team release excludes sprints, Scrum roles, story points, roadmaps, dependency graphs, time tracking, automation, custom fields, due dates, file attachments, email notifications, offline editing, and public signup.

## Spaces and people

- One installation contains several Spaces. Each Space is a membership boundary and contains exactly one Board.
- A Space has one editable display name and one editable IANA time zone. Report boundaries and scheduled archive decisions use the Space time zone.
- A Space has an immutable, installation-unique short key. Task numbers are sequential within the Space, producing keys such as `DIG-5`.
- Space keys are never reused within an installation, even after permanent deletion. A deleted Space leaves only a non-personal key reservation.
- Sign-in uses one installation-configured OpenID Connect provider. The server creates PostgreSQL-backed sessions and the browser receives a Secure, HttpOnly, SameSite cookie.
- A session expires after five days without activity or 30 days after sign-in, whichever comes first. Dig rotates its identifier after sign-in and permission changes and revokes it when the identity loses all Dig access.
- Existing valid sessions continue during an identity-provider outage. New sign-ins wait for the provider to recover; Dig has no fallback password or trusted-header login.
- Installation administrators may create Spaces and become their first Space administrators. There is no public Space creation.
- Runtime configuration holds the allowed OpenID Connect subjects for installation administrators. Removing a subject prevents future Space creation but does not change existing Space membership.
- A Space administrator manages invitations, membership, Space settings, and permanent Space deletion. Every Space retains at least one administrator.
- Invitations are revocable, single-use links that expire after seven days. The recipient authenticates before accepting.
- Removing a Member preserves attribution and history, unassigns open Tasks, and deactivates the membership.
- Any Member may leave a Space. The last Space administrator must promote another Member before leaving or removing themselves.
- Tasks reference an optional Assignee by stable Member identity. Display-name changes do not affect assignments or attribution.
- Archiving a Space makes it read-only, revokes pending invitations, closes its live connections, and removes it from normal navigation. A Space administrator may restore it.
- Permanent Space deletion has a seven-day cancellation period. Any Space administrator may cancel it during that period.

## Board and flow

- Each Board has exactly one Intake Column and one Completion Column. Columns have stable Queue, Active, or Complete roles beneath customizable names.
- A Board has no separate display name because its Space already names the work area.
- The default Intake name is `Backlog`; the default Completion name is `Done`.
- A new Space starts with `Backlog` as Queue and Intake, `In Progress` as Active with WIP limit 3, and `Done` as Complete.
- Every new Task and Subtask enters Intake. Subtasks are limited to one level and have their own Task keys and flow positions.
- Every Active Column has a positive WIP limit. Creating one suggests a limit of three, which the team must confirm or change. Exceeding a limit warns but does not block movement.
- Dig shows the evidence behind a possible bottleneck. It does not declare a cause. Evidence includes current WIP, limits, Column age, oldest Active Tasks, throughput, and Cycle time.
- Entering the Completion Column closes a Task. Dragging there defaults the Outcome to Completed; `Close as...` also offers Rejected, Duplicate, and Cancelled.
- Moving a Closed Task out of Complete reopens it and clears its current Outcome. History retains the earlier closure.
- Closing a parent with open Subtasks warns but remains allowed. Subtasks do not close automatically.
- All Closed Tasks count as flow throughput with Outcome breakdown. Only Completed counts as delivered work.
- Every Task and Subtask in an Active Column counts toward WIP. Queue and Complete do not.
- Closed Tasks remain visible for 30 days and then archive automatically. Archive preserves comments and flow history. Archiving a parent archives its Subtasks.
- Restoring an archived open Task places it in Intake and records a new transition. Restoring an archived Closed Task places it in Complete with its Outcome intact. A parent and its Subtasks restore together.
- Archived Columns retain identity and transition history. A Column must be empty before its role changes or it archives. Intake or Complete replacement is atomic.
- An archived Column restores empty with its previous non-terminal flow role and WIP limit.
- Dragging is disabled while search or filters are active because filtered ordering is ambiguous.

## Task model and collaboration

- A Task has a title, optional description, optional Assignee, tags, one level of Subtasks, and comments. Board order expresses priority, so there is no Priority field.
- Task numbers are never reused within a Space.
- Every current Member can see every Task, Subtask, comment, assignment, and Task-history entry in the Space. Dig has no private Tasks, restricted Columns, or field-level permissions.
- Descriptions and comments are plain text with preserved line breaks. Dig auto-links safe web URLs, accessible Task references, and Member mentions. The first release has no Markdown, HTML, or rich-text editing.
- Server-side text limits are 60 Unicode characters for Space and Column names, 200 for Task titles, 20,000 for descriptions, 5,000 for comments, and 40 per Tag. A Task has at most 20 Tags.
- Tags are Space-scoped, case-insensitively unique, and created inline with autocomplete.
- Task references auto-link only when the current Member can access the target Space. An inaccessible key reveals nothing about whether a Task exists.
- Duplicate requires a reference to another Task in the same Space. Rejected and Cancelled may include an optional closing comment, not a separate field.
- A Closed Task's Outcome may change without changing Closed at or Cycle time. Every Outcome change remains in history.
- Comment authors may edit their own comments with an edited marker. Deletion leaves a tombstone. Space-administrator moderation is recorded.
- Mentions reference stable Member identity.
- The in-app inbox covers new assignments, direct mentions, and comments on assigned Tasks. The first team release has no email, push, watches, or notification rules.
- Notifications have unread and read states, become read when the relevant Task opens, and expire after 90 days. Members can mark all read and never receive notifications for their own actions.
- Open clients receive Board changes within a few seconds. Ordinary mutations use HTTP; server-to-client updates use Server-Sent Events with sequence numbers and snapshot recovery.
- Task edits use revisions. A stale form shows the Member's draft beside current data. A stale drag refreshes the Board and explains that another move won.
- Dig requires a connection for changes. A loaded Board may remain readable during an outage, but editing and dragging pause.
- Search, inbox, workload, and reports stay inside the current Space. A Space switcher reopens the Member's last Space; the first release has no cross-Space dashboard.
- Initial loading returns Space metadata, Members, Columns, WIP counts, and a bounded page of Task summaries. Queue, Complete, Archive, and search results use stable cursor pagination. Description, comments, and history load when a Task opens.

## Flow history and reports

- Dig stores immutable Column transitions, closures, reopenings, Outcome changes, and moderation actions beside current-state tables. The application is not event-sourced.
- Column age starts at the latest entry into the current Column.
- Started at is the first entry into any Active Column. Closed at is the latest entry into Complete.
- Cycle time is calendar time from Started at to Closed at. Reopening preserves Started at, so later closure includes rework time.
- The Flow view shows WIP against limits, oldest Active Tasks, 30-day median Cycle time, weekly throughput by Outcome, and WIP history by Column.
- Member workload shows currently assigned Active Tasks only. Dig never ranks Members by throughput, Cycle time, or Tasks completed.
- Members can see Task history. Space administrators can also see membership, invitation, workflow-setting, moderation, archive, and deletion actions.
- Task history and administrative audit records remain for the Space's lifetime and appear in its export.
- Search stays within one Space and covers Task key, title, description, tags, and Assignee. It searches active work by default, with an explicit option for Closed and Archived Tasks. It does not search comments in the first release.

## Supported clients

- Core flows target WCAG 2.2 AA with keyboard operation, visible focus, screen-reader labels, reduced motion, and a non-drag `Move to Column` action.
- Desktop and tablet show the full Board. Phones use horizontal Column navigation and the explicit move action. Dig has no native application.
- Dig supports the current and previous major releases of Chrome, Edge, Firefox, and Safari. Main flows run in automated Chromium, Firefox, and WebKit tests.
- Store timestamps in UTC. Display them in the Member's browser time zone with the exact timestamp available.
- The first-release interface is English only and accepts Unicode Member content. It has no native application.

## Architecture and deployment

- Keep the React, Node, and PostgreSQL modular monolith. Do not add microservices, a broker, a cache, GraphQL, Kubernetes, or PostgreSQL row-level security.
- Keep the JSON API private to the Dig frontend. The first release has no API tokens, webhooks, bots, or third-party integrations beyond OpenID Connect.
- Build one OCI application image from a repository-owned container definition. Local development uses Compose.
- Production runs through self-hosted Coolify on the Hetzner server with one steady-state application replica. PostgreSQL is a separate private Coolify database resource.
- Every request resolves identity from the server session, verifies active Space membership, and passes an opaque `AuthorizedSpace` into the target Module. Board transactions recheck that evidence against concurrent revocation.
- Every Space-owned record carries Space identity. Composite database constraints prevent cross-Space relationships.
- Space, Member, Column, Task, Comment, and history records use opaque stable IDs. Mutable names and slugs never act as relationships. Human-facing Space keys and Task numbers may appear in URLs but grant no access.
- The application container is stateless. It has no persistent volume.
- Coolify terminates TLS for one HTTPS domain and routes to the container's internal port. Neither the application nor PostgreSQL publishes a host port.
- Runtime-only Coolify variables hold the database URL, OpenID Connect credentials, session secret, and CSRF secret.
- `/health/live` checks the Node process. `/health/ready` checks completed startup, current migrations, and PostgreSQL connectivity. Coolify routes using readiness.
- Compatible releases may use health-gated rolling updates. Incompatible schema changes use a maintenance window.
- On startup, the new container takes the PostgreSQL migration lock, applies checksummed transactional migrations, and stays unready until they succeed.
- Operators take daily custom-format PostgreSQL backups to S3-compatible storage outside the Hetzner server, retain daily backups for 14 days and monthly backups for 12 months, and test restoration quarterly.
- Permanent Space deletion removes active data after its grace period. Existing backups retain copies until normal expiry; recovery restores a whole backup, not one selectively deleted Space.
- Space administrators may export a Space as versioned JSON with export-local identifiers, schema version, and generation time. It includes display names and Space-owned Board, Task, comment, tag, Outcome, flow, and audit data. It excludes OIDC subjects, sessions, invitation tokens, secrets, and internal database IDs. Import remains deferred until a migration use case appears.
- Monitor external HTTPS availability, readiness, PostgreSQL availability, disk usage, and backup age. Alert the operator without adding product analytics or a product-facing status page.
- During network or database failure, the client keeps the last confirmed Board visible with a disconnected banner, disables changes, and fetches a full snapshot before reconnecting.
- The server writes structured logs to standard output with request IDs. Logs exclude Task descriptions, comments, OIDC tokens, cookies, and secrets.
- Operators rotate operational logs after 30 days. Space audit records follow the Space's lifetime instead.
- The first release supports up to 25 active Members per Space, 20 active Spaces per installation, 100,000 retained Tasks per Space, and 100 concurrent browser connections.
- The operator recovery target is at most 24 hours of data loss and restoration within four hours after recovery begins. It is not a hosted-service SLA.
- On termination, the application fails readiness, rejects new mutations, asks Server-Sent Event clients to reconnect, drains active HTTP requests for up to 30 seconds, closes PostgreSQL connections, and exits.
- The team MVP starts from a new schema and empty database. No current prototype data or schema compatibility is preserved. Later production changes continue to use checksummed migrations.
- Implementation proceeds through tested vertical slices, with obsolete fields removed only after their replacements work.

## Recorded ADRs

- [ADR 0001](../adr/0001-deploy-one-application-container-through-coolify.md): one application container through Coolify with separate PostgreSQL.
- [ADR 0002](../adr/0002-delegate-identity-and-authorize-every-space.md): delegated identity and explicit Space authorization.
- [ADR 0003](../adr/0003-separate-flow-position-from-closure-outcome.md): flow roles, closure Outcomes, and append-only history beside current state.
- [ADR 0004](../adr/0004-archive-shared-work-before-deletion.md): archive shared work before permanent deletion.
- [ADR 0005](../adr/0005-reset-the-pre-mvp-database.md): reset disposable prototype data for the first MVP.
- [ADR 0006](../adr/0006-make-space-work-visible-to-all-members.md): keep all Space work visible to every current Member.
- [ADR 0007](../adr/0007-separate-stable-identity-from-human-keys.md): separate stable record identity from human-facing keys.
- [ADR 0008](../adr/0008-put-board-behavior-behind-one-deep-module.md): put Board behavior behind one deep Module.
- [ADR 0009](../adr/0009-separate-identity-and-space-with-transactional-rechecks.md): keep identity and Space access separate while rechecking authorization in Board transactions.

## Codebase design

[Codebase Module design](codebase-module-design.md) records the selected three-entry `BoardModule` Interface, alternatives considered, Module arrangement, Seam discipline, performance contract, and testing strategy.

[Identity and Space Module design](identity-space-module-design.md) selects separate upstream Modules, opaque request capabilities, and the private transactional recheck. [BoardModule Interface contract](board-interface-contract.md) freezes the command, query, update, warning, and fault baseline. [Team MVP vertical-slice plan](vertical-slice-plan.md) defines the implementation sequence and proof required for each slice. Implementation advances only through user-authorized vertical slices.

## Current repository gap

The running browser and HTTP path now have OpenID Connect authentication, PostgreSQL sessions, multiple Spaces, explicit authorization, the empty default Board, safe invitations, membership administration, administrative audit, and Space lifecycle management. [Slice 1 implementation notes](../implementation/slice-01-authenticated-space-shell.md) and [Slice 2 implementation notes](../implementation/slice-02-safe-team-membership.md) record the exact delivered behavior.

The retained prototype Task files still use free-text assignees, a four-level Priority field, recursive Subtasks, and a literal `done` slug. They are no longer the running browser path and remain only until Slice 3 replaces their behavior and tests. Team-path Task behavior, live updates, transition history, Outcomes, and Task revisions and archive behavior are not implemented yet.

The repository was already heavily modified before this interview. Preserve unrelated existing changes while implementing only the vertical slice the user has authorized.

README, `ARCHITECTURE.md`, the risk register, and operating instructions continue to describe current behavior until code changes make each target claim true. Update them with implemented vertical slices, never ahead of the code.

## Next step

Slices 1 and 2 are complete. The running path now includes safe invitations, membership and role changes, permission-triggered session effects, administrative audit, opaque administrative paging, Space archive and restore, and concurrency tests for revocation against Board access. [Slice 2 implementation notes](../implementation/slice-02-safe-team-membership.md) record the delivered behavior.

The next planned action is Slice 3: Task capture, editing, assignment, tags, bounded pages, archive and restore, and the browser `BoardSession`.

## Team-release gates

The first team deployment requires:

- anonymous, cross-Space, and cross-role denial tests for every protected resource;
- OpenID Connect callback, session expiry, CSRF, invitation expiry, and invitation replay tests;
- last-administrator and Archived-Space read-only tests;
- concurrent numbering, ordering, stale revision, WIP, closure, Outcome, history, and archive tests against PostgreSQL;
- Server-Sent Event reconnect and missed-sequence recovery tests;
- keyboard, dialog, automated accessibility, phone-width, and supported-browser end-to-end tests;
- clean-database setup and future migration-runner tests, with no prototype-data migration;
- export schema and privacy tests;
- load tests at the promised Member, Space, Task, and connection boundary;
- a documented full backup restore completed successfully.
