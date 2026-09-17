# Slice 11: connect Codex and read work

Implemented locally on 2026-09-16. Desktop interaction and production deployment remain unverified. Slices 12–14 add work claims, writes, handoff, and the combined release checks; this slice exposes read access only.

## Delivered behavior

Space administrators can enable agent access in Manage Space. It defaults off, including for existing Spaces after migration. Members use Agent connections in the personal menu to create named connections for up to 20 selected, enabled Spaces. Tokens expire after 30 days, appear once, and can be replaced or revoked. Dig stores SHA-256 verifiers of randomly generated 256-bit secrets.

`AgentModule.manage`, `authenticate`, and `read` own connection behavior. Private Space helpers own membership and policy SQL; Identity owns browser-session checks. Board reads reuse `BoardModule`. Each Board transaction rechecks Space, Member, connection revision, expiry, policy revision, and membership generation before reading. Losing access after authentication still denies the read. Grants bind the precise membership join timestamp because re-invitation can reuse a Member ID.

Connections use `tasks:read`, enforced by a database constraint. A future release must request explicit write consent. No session capability, caller-supplied identity, generic SQL operation, human inbox, export, or administration operation is exposed through MCP.

`/mcp` authenticates every request using the Authorization bearer header. Cookies do not authenticate it. Origin and Host are validated; query strings are rejected. The browser settings endpoints retain normal cookie, Origin, and CSRF checks. The personal connection screen never persists a raw token in browser storage. Closing it clears the displayed token.

Six tools read Spaces, Space context, Task search, Task detail, Tags, and workflow. Task context includes independently paged comments, history, and Subtasks. Reads preserve human notification state. Search defaults to open work; closed and archived context requires explicit selection. A Space context response includes up to 200 Members and one sample Task per Column; search provides Task pagination.

## Bounds and recovery

- 10 items by default, at most 50 per page. Board cursors preserve existing expiry and revision rules.
- 64,000-byte request body, with a 15-second body/authentication deadline.
- 750,000-byte serialized tool payload before MCP's text and structured representations. Oversize faults include `response-too-large` and smaller-page guidance.
- Four concurrent MCP requests per process, reserved before authentication. A regression holds authentication pending to verify this bound.
- 60 authenticated requests per connection per minute and 120 per accountable person. A 300-per-minute source-address limit also applies before authentication. Buckets are bounded and reset on process restart; this is a single-replica policy.
- Agent SQL statements time out after five seconds; lock waits after three seconds. Pool acquisition is bounded by the existing five-second limit.
- Creation uses a caller-generated connection ID to prevent duplicate issuance after a lost response. Dig cannot redisplay a lost secret; replace the token explicitly.
- Disabling/re-enabling Space access and removal/re-invitation never revive old grants. Replacing a token preserves its grants; create a new connection to grant invalidated Spaces again.

## Compatibility evidence

Runtime SDK packages are pinned to `@modelcontextprotocol/server` and `@modelcontextprotocol/node` 2.0.0, with `zod` 4.6.5. The independent client is `@modelcontextprotocol/client` 2.0.0. Tests cover both its modern and legacy negotiation modes, as well as Codex's exact initialization envelope.

Actual Codex CLI 0.154.0 invoked the bundled `$dig` skill and retrieved a unique Task title from a disposable Dig database using MCP 2025-06-18. The test used the CLI's existing login, an isolated temporary Codex home, and a token supplied only through the child process environment. It restored no production state and changed no normal Codex configuration. Temporary credentials and workspace files were removed afterward.

Reproduce after building, with a disposable loopback database named `dig_mcp` and an installed, authenticated Codex CLI:

```sh
DIG_MCP_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:PORT/dig_mcp node scripts/test-agent-codex.mjs
```

This opt-in test invokes the configured OpenAI model. It is separate from ordinary CI. Its first test observer incorrectly consumed request bodies; the observer now records Module calls and protocol headers without reading the stream.

On 2026-09-17, production readiness returned 200 and the native Codex MCP connection listed six read tools, read the COOL Space, and read COOL-1. This verifies production read access in the current Codex session. The full desktop create/read/revoke sequence remains a manual gate. See [setup](../agent-setup.md) for the environment-variable requirement, then manually create a connection, read a real Task, revoke it, and verify the next call fails.

## Verification

Passed locally on 2026-09-16:

| Check | Result |
|---|---|
| Build and lint | Passed |
| Regular suites | 82 tests passed |
| Sequential PostgreSQL suites | 110 tests passed, including existing-data migration preservation |
| Browser suites | 8 passed across Chromium, Firefox, WebKit, and phone; accessibility scans included |
| Codex CLI and local skill | Actual Task read passed on CLI 0.154.0 with MCP 2025-06-18 |
| Independent MCP client | Modern and legacy negotiation passed |
| Node 22 production image | Build and startup passed; readiness healthy and unauthenticated MCP denied |
| Backup/restore drill | 26 tables and 52 rows preserved, including agent tables |
| Standards and specification review | Both reported no unresolved implementation findings after fixes |

Local checks cover the browser token lifecycle, phone layout, keyboard focus, accessibility scans, token expiry, replacement, revocation, owner and selected-Space isolation, membership removal/re-invitation, policy invalidation, unread-inbox preservation, cursor pages, request budgets, and the concurrency boundary. Expiry is tested with an issuance clock in the past, with no agent listener running. This is simulated absence, not a multi-day production observation.

This records the Slice 11 read-only release. Slice 12 extends the skill with work mode; see [its implementation notes](slice-12-agent-work.md). Full desktop lifecycle checks, multi-day absence, the complete agent-work feature, and Slice 10's off-server backup/monitoring gates remain separate.
