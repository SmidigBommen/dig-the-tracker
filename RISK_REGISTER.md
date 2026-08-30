# Risk register for local single-user use

Status: **Accepted for local use. Shared-network and public deployment are out of scope.**

| Risk | Current mitigation | Verification or future gate |
|---|---|---|
| No signup/login means every caller is the local actor | API and database bind to host loopback; origins are allowlisted; non-loopback API binding is rejected unless the container override is explicit | Before any shared exposure, add authentication, server-side sessions, authorization, membership isolation, and anonymous/cross-workspace denial tests |
| A browser spoofs identity or workspace scope | HTTP inputs do not accept trusted actor or board IDs; the server injects configured IDs | Service-boundary tests cover fixed identity and safe binding configuration |
| Removing Supabase Auth makes a future provider expensive | Stable actor IDs and actor context remain behind the HTTP/service boundary; task and comment ownership is preserved | Future auth resolves a verified principal to an actor before services run; no frontend-supplied identity becomes trusted |
| Concurrent writes duplicate issue numbers or positions | Board-row locking and database transactions serialize allocation | Verified locally: `npm run test:db` creates eight tasks concurrently against real PostgreSQL; CI repeats the test |
| Migration drift or two processes migrating together | Ledger, SHA-256 checksums, advisory lock, and per-migration transactions | Unit tests cover parsing; real-database tests apply migrations before repository tests |
| Container tooling differs by host Python/runtime setup | Repository wrappers isolate the Compose provider and Podman service socket; DB tests use a disposable named container and `tmpfs` | Run `npm run test:db`; retain Compose rather than adding Kubernetes until orchestration requirements materially change |
| Persistent local data is lost or corrupted | Named PostgreSQL volume plus explicit custom-format backup/restore commands | Complete a restore drill before relying on the data; keep an off-host copy for important data |
| Another tab displays stale state without live updates | Mutation responses update local state and focus triggers full bootstrap resync | Add polling or SSE only with a concrete multi-client requirement and reconnect/resync tests |
| A future feature accidentally makes the app public | Documentation and configuration treat public exposure as a release gate, not a runtime toggle | Security review must include rate limits, CSRF/session policy, TLS/proxy configuration, authorization tests, backup/restore, and dependency scanning |

## Reintroducing identity later

Do not restore signup as an isolated screen. It needs identity verification, session handling, actor linking, membership checks, onboarding and recovery, abuse controls, audit rules, and negative integration tests. Connect those parts through the existing actor context. The domain API and PostgreSQL repository should not depend on a specific identity provider.
