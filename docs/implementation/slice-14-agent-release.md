# Slice 14: intermittent use and release compatibility

Started on 2026-09-17. Dig is now the work log for this slice as well as the product being developed. Code, specifications, and reproducible evidence remain in Git; the Board records active work, findings, blockers, and human review decisions.

## Board tasks and sequence

The connected Space is COOL, named `coolify-test-space`. Task links use the production Task route.

| Task | Deliverable | Depends on |
|---|---|---|
| [COOL-6](https://dig.smidigbommen.no/spaces/COOL/tasks/COOL-6) | Acceptance inventory and Board working agreement | None |
| [COOL-7](https://dig.smidigbommen.no/spaces/COOL/tasks/COOL-7) | Disconnected work and durable retry recovery | COOL-6 |
| [COOL-8](https://dig.smidigbommen.no/spaces/COOL/tasks/COOL-8) | MCP contract and resource-limit checks | COOL-6 |
| [COOL-9](https://dig.smidigbommen.no/spaces/COOL/tasks/COOL-9) | Codex setup, skill, and credential recovery guidance | COOL-7, COOL-8 |
| [COOL-10](https://dig.smidigbommen.no/spaces/COOL/tasks/COOL-10) | Combined browser and release verification | COOL-7, COOL-8, COOL-9 |
| [COOL-11](https://dig.smidigbommen.no/spaces/COOL/tasks/COOL-11) | Desktop lifecycle and actual multi-day absence evidence | COOL-9, COOL-10 |

Creation through MCP assigns work to the delegating Member and briefly creates a claim. Backlog creation claims were explicitly released. Claim only the Task being worked on. Review means ready for the person's decision; it does not mean deployed or complete.

Use [the MCP explanation](../mcp-how-it-works.md) for the sequence and information-flow SVGs, [agent setup](../agent-setup.md) for installation, and [the feature specification](../design/agent-access.md) for the acceptance contract.

## Working agreement

Before implementation, read the relevant Task, discussion, current workflow, and repository guidance. Claim the Task and move it to In Progress. Put its key in the commit subject or PR description so the Board and Git can be followed together.

Post comments when there is a useful finding, decision, scope change, or verification result. Include repository paths and commit references where relevant. Do not post heartbeat comments or private credentials. Keep unrelated existing Tasks unchanged.

When blocked, use the blocker report with the specific help needed; the operation releases the claim. When work is ready for human review, use the review handoff with changes, checks and their outcomes, limitations, and a commit reference. Preserve uncertain request IDs for exact replay before submitting a new operation. A human closes the Task. Push and deployment remain separate user-authorized actions.

The Board supplies current status and review decisions. This document supplies stable acceptance mapping and evidence; status tables here are not a replacement for rereading the Board.

## Acceptance inventory

Numbers refer to the twelve scenarios in [the specification](../design/agent-access.md#acceptance-evidence). Existing tests are starting evidence from earlier slices, not a claim that Slice 14 is finished.

| Scenario | Existing evidence | Remaining work / owner |
|---|---|---|
| 1. Human Board use without an agent | Browser Task flow and ordinary Module suites | Combined regression run, COOL-10; real absence observation, COOL-11 |
| 2. Scoped connection and credential lifecycle | Slice 11 selected-Space isolation, expiry, revocation; production native reads | Full desktop create/replace/revoke sequence, COOL-9 and COOL-11 |
| 3. Competing claims and separate runs | Slice 12 race, assignment preservation, public-ID takeover tests | Include in final regression evidence, COOL-10 |
| 4. Human edits and invalidation | Slice 12 stale revisions, reassignment, lifecycle, and human release tests | Reconnected real MCP client with intervening edits, COOL-7 |
| 5. Claim expiry without check-ins | Slice 12 deterministic expiry and browser badge tests | Return after simulated prolonged absence, COOL-7; actual absence, COOL-11 |
| 6. Return days later with new context | Separate existing read and claim tests | Combined changed-context/reacquisition scenario, COOL-7; dated real observation, COOL-11 |
| 7. Atomic capture, child isolation, retry identity | Slice 12 creation and child-claim tests | Confirm relevant receipts survive fresh server instances, COOL-7; final regression, COOL-10 |
| 8. Atomic blocker/review and lost response | Slice 13 rollback, exact retry, and concurrent handoff tests; production COOL-3 | Replay a committed handoff with fresh server/client instances, COOL-7 |
| 9. Changed review mapping | Slice 13 stale workflow and configuration tests | Final regression evidence, COOL-10 |
| 10. Attribution and recipient inbox behavior | Slice 13 self-notification/mention tests and browser report/inbox checks | Preserve under recovery tests, COOL-7; final browser run, COOL-10 |
| 11. Skill and client compatibility | Actual CLI 0.154.0 show/work/handoff with MCP 2025-06-18; independent client negotiation | Contract gaps, COOL-8; updated actual-client/setup evidence, COOL-9; desktop gate, COOL-11 |
| 12. Accessible controls and release checks | Slice 13 four browser profiles, all six themes, image and restore checks | Final combined checks for resulting revision, COOL-10 |

Public verification boundaries remain IdentityModule, SpaceModule, AgentModule, BoardModule, SpaceExportModule, the real HTTP/MCP endpoint, and browser behavior. PostgreSQL is real and disposable. Tests do not substitute internal repositories or inspect private implementation state to prove behavior.

## Evidence recorded so far

On 2026-09-17, production COOL-3 was claimed in Backlog, moved to In Progress, and handed to Review with an explicitly labelled simulation report and `not-run` verification. The confirmed handoff receipt and subsequent Task read showed the report and released claim. The user then commented “Perfect! closing the task” and moved it to Done with Completed outcome. A fresh MCP read observed both the human comment and closure. MCP did not read the private inbox or receive an automatic notification of the user's comment.

COOL-6 inventories the earlier automated evidence and adds the Board working agreement plus links to the previously requested MCP guide/SVGs. Local Markdown links and SVG XML were checked, and both diagrams were rendered for layout inspection. This documentation work does not require a new application regression run.

## Gates that remain open

COOL-11 requires actual desktop interaction and elapsed time. Simulated clocks establish deterministic server behavior; they do not establish multiple days of production observation. Record dates, tested client versions, Task references, the intervening human changes, and the return result before treating that gate as passed.

The original Slice 10 off-server backup and monitoring activation remain separate operational obligations. Agent feature verification does not close them. No production credential will be revoked, production load test run, or deployment performed merely to fill this evidence table.
