# Migration Plan — Supabase → Local Postgres

Status: **Draft for review.** No code changes yet.

**Decisions locked in (2026-04-18):**
- **Architecture:** Option B — drop Supabase, custom backend + local Postgres.
- **Runtime:** Node 22 + Fastify + `pg` + `ws`.
- **Host:** user's own Ubuntu cloud server (deferred — Scope-1 doesn't deploy yet).
- **Packaging:** podman-compose.
- **Auth round 1:** **R1-A — display-name login, HttpOnly cookie, no email, no password.**
- **Scope:** **Scope-1 — local dev only.** Prod stays on Supabase until a future decision. Phase 7 (deploy) and Phase 8 (prod cutover) are out of scope for this pass.
- **Timeline:** none. Keep it simple.

**Effective plan:** Phases 0 → 6. Target ~6–8 working days.

---

## 1. What we actually depend on today

Before choosing a target, map the Supabase surface area actually in use. Going off the current code:

| Supabase feature | Where it's used | Replaceability |
|---|---|---|
| **Postgres database** | all migrations in `supabase/migrations/` | Easy — it's vanilla Postgres with one exception (see RLS). |
| **Auth (magic link)** | `AuthContext.tsx` — `signInWithOtp`, `getSession`, `onAuthStateChange`, `signOut` | Hard — needs email delivery + JWT issuance + session mgmt. |
| **`auth.users` schema + `auth.uid()`** | all FK columns, `is_board_member()`, `accept_invite()`, every RLS policy | Hard — these are GoTrue's schema. Must be stood up or replaced. |
| **PostgREST query API** | `TaskContext.tsx` — `.from().select/insert/update/delete().eq().order().single()` (~12 call sites) | Medium — either run PostgREST, or write a thin REST layer. |
| **RPC (stored procs)** | `create_task`, `create_default_board`, `accept_invite`, `next_task_number` | Easy — same SQL, called via any Postgres client. |
| **Realtime** | `TaskContext.tsx` — `supabase.channel().on('postgres_changes').subscribe()` for `tasks`, `task_comments`, `columns`, `board_members` | Hard — needs logical replication + a WebSocket server. |
| **Row Level Security** | all tables; `is_board_member()` uses `auth.uid()` | Depends — RLS itself is just Postgres, but `auth.uid()` comes from Supabase's JWT → GUC plumbing. |

**Deployment reality:** today it's a static SPA on GitHub Pages talking directly to Supabase. Dropping Supabase ends that arrangement — **something has to run server-side.** That is the biggest shift in this migration, not the database swap.

**Files that will change (or be rewritten):**
- `src/lib/supabase.ts` — client entry, replace or re-implement
- `src/context/AuthContext.tsx` — sign-in flow, session mgmt
- `src/context/TaskContext.tsx` — CRUD + realtime
- `src/components/InviteHandler.tsx` — RPC call
- `src/lib/migrateLocalData.ts` — one-time helper, easy
- `src/test/supabaseMock.ts` — rewrite against new client
- `supabase/migrations/*.sql` — port, strip Supabase-specifics
- `package.json` — drop `@supabase/supabase-js`, add new deps
- `.github/workflows/deploy.yml` — deploy target changes if we need a server

---

## 2. Target architectures — three realistic options

### Option A — Self-host full Supabase stack (Postgres + GoTrue + PostgREST + Realtime)

Run the open-source Supabase components via `supabase start` (Docker Compose) or a hand-rolled compose. Client keeps using `@supabase/supabase-js`.

- **Effort:** S. Nearly zero code change.
- **What changes:** env vars point at `http://localhost:54321`; prod points at your own server.
- **Pros:** All features keep working (realtime, RLS, magic link). Fastest path.
- **Cons:** Not actually "off Supabase" — same stack, different host. You own ops now (backups, upgrades, TLS, SMTP). Realtime server is Elixir; another runtime to babysit.
- **Best if:** the motivation is *data residency / cost / vendor lock-in*, not *simplification*.

### Option B — Postgres only + thin custom backend (Node/Bun + `pg` + WebSocket)

Run local Postgres. Write a minimal backend (Express/Fastify/Hono) that: (1) issues sessions, (2) exposes CRUD + RPC endpoints the client already uses, (3) broadcasts realtime events via WebSocket, (4) enforces auth/membership in middleware (RLS becomes optional belt-and-braces).

- **Effort:** L. Roughly 1–2 weeks of solid work.
- **What changes:** supabase-js → custom client wrapper with same shape (or a fetch-based client). AuthContext rewritten around cookie/JWT sessions. Realtime re-implemented on top of WS (Postgres `LISTEN/NOTIFY` is the natural fit).
- **Pros:** Full control. No Supabase-specific schema (`auth.users`, `auth.uid()`). Smaller surface area to reason about.
- **Cons:** You own auth security (that's the scary part). Rebuilding realtime from scratch is the most error-prone piece. Testing story is now "did we port the mock correctly?"
- **Best if:** the motivation is *simplification / dropping the dependency entirely*.

### Option C — Postgres + PostgREST + an auth library (e.g. Lucia/Better-Auth)

Run Postgres + PostgREST for data, use a purpose-built auth library (Lucia, Better-Auth, Auth.js) instead of GoTrue. Realtime stays custom (LISTEN/NOTIFY + WS) or gets dropped temporarily.

- **Effort:** M.
- **Pros:** PostgREST keeps most of the `.from().select()` shape working. Auth libraries are nicer to integrate than GoTrue.
- **Cons:** Still three things to run. RLS policies need reworking because `auth.uid()` won't exist — policies need to read a different GUC or be replaced by app-layer checks.
- **Best if:** you want to keep the declarative RLS + query model but ditch Supabase-auth specifically.

### Decision: Option B ✅

Dropping Supabase entirely. Phases below assume this.

---

## 3. Phased plan (Option B, podman-compose, Ubuntu host)

**Proposed stack:**
- **DB:** `postgres:16` container.
- **API:** Node 22 (LTS) + **Fastify** + `pg` + `ws`. Chosen over Bun+Hono because the repo already uses `node:22-alpine` in `Containerfile`, and Ubuntu + Node is the lowest-friction path. Everything is TypeScript.
- **Web:** existing nginx container, unchanged except it proxies `/api` and `/ws` to the API container.
- **Reverse proxy (prod):** Caddy — one-line TLS via Let's Encrypt.
- **Layout:**
  ```
  ./api/           ← new Node backend (own package.json)
  ./db/migrations/ ← ported SQL, no auth.* references
  ./src/           ← existing frontend (unchanged structure)
  compose.yml      ← db + api + web + caddy (prod)
  compose.dev.yml  ← db + api only; Vite dev server runs on host
  ```

Each phase ends in a runnable, testable checkpoint.

### Phase 0 — Baseline & safety net (½ day)
1. Commit `CODE_REVIEW.md` and `MIGRATION_PLAN.md`.
2. Add a feature flag `VITE_BACKEND=supabase|local` so both clients coexist during the build-out.
3. Export current prod data via `pg_dump` of the Supabase DB (rollback + eventual import material).
4. Tag current commit as `pre-local-migration`.

### Phase 1 — Postgres pod + ported schema (1 day)
1. Add `compose.dev.yml` with a `db` service (`postgres:16-alpine`, named volume, exposed on `127.0.0.1:5432`).
2. Create `db/migrations/` by porting `supabase/migrations/*.sql`:
   - Drop `references auth.users(id)` → `references public.users(id)`.
   - Create `public.users(id uuid pk default gen_random_uuid(), email text unique, display_name text, created_at)`.
   - Replace `auth.uid()` with `current_setting('app.user_id', true)::uuid`.
   - Keep all RLS policies verbatim otherwise.
3. Add `db/seed.sql` — a couple of dev users + a sample board.
4. Add npm scripts at repo root: `db:up` (podman-compose up -d db), `db:down`, `db:psql`, `db:reset` (drop volume + re-up + run migrations + seed), `db:migrate`.

**Checkpoint:** `npm run db:reset && npm run db:psql`. Confirm: `SET app.user_id='…dev-uid…'; SELECT * FROM tasks;` shows only that user's board.

### Phase 2 — API scaffold, stub auth (1–2 days)
1. Scaffold `./api/` with Fastify + TS, own `Dockerfile` (uses `node:22-alpine` like the existing Containerfile).
2. Wire `pg` pool. Add middleware: on each request, set `app.user_id` GUC on the connection for the duration of the handler (wrap queries in a transaction that `SET LOCAL`s).
3. Implement endpoints mirroring current calls (list in §1). Shape responses like PostgREST so the client adapter stays thin.
4. Auth is stubbed — a `GET /auth/dev-login?name=…` that sets a cookie; all requests trust the cookie.
5. Add service to `compose.dev.yml`.

**Checkpoint:** `curl` flow hits every endpoint as two different dev users; RLS blocks cross-board reads.

### Phase 3 — Client adapter + cutover of local dev (1 day)
1. Create `src/lib/backend.ts` — a thin chainable client whose shape mimics supabase-js (`backend.from('tasks').select().eq(…)`) but calls our REST endpoints. Realtime and auth namespaces are stubs initially.
2. Re-export `supabase` from `src/lib/supabase.ts` as either the real supabase-js or our backend based on `VITE_BACKEND`. This keeps `TaskContext.tsx` near-untouched.
3. Disable realtime subscription when `VITE_BACKEND=local` — fall back to a 30s poll on the board.

**Checkpoint:** `VITE_BACKEND=local npm run dev` — app loads, CRUD works, no realtime.

### Phase 4 — Minimal auth (½–1 day with round-1 scope; see §6 proposal)
Round 1 is deliberately the smallest viable thing. Details are the one open question — see §6.

After this phase:
1. `AuthContext.tsx` calls our `/auth/*` endpoints (shape unchanged from the component's POV).
2. Session cookie → GUC propagation is production-ish, not dev-login.
3. `supabaseMock.ts` replaced by `backendMock.ts` against the same client shape, OR switched to MSW (recommend MSW once backend is stable).

**Checkpoint:** real sign-in works; unauthenticated requests 401; RLS-denied requests 403.

### Phase 5 — Realtime via LISTEN/NOTIFY (2–3 days, highest risk)
1. Postgres triggers on `tasks`, `task_comments`, `columns`, `board_members` that `NOTIFY board_{id}` with `{op, table, id}` (IDs only — avoids the 8KB NOTIFY payload limit).
2. API keeps one dedicated `LISTEN` connection. On notification, refetches the row and broadcasts to subscribed WebSocket clients filtered by `board_id`.
3. On WS connect, verify session + board membership before subscribing.
4. Client `backend.channel()` shape mirrors supabase-js; reducer wiring unchanged.
5. Keep the 30s poll from Phase 3 as a belt-and-braces fallback, behind a flag.

**Checkpoint:** two browser tabs on two accounts see each other's edits within ~1s; killing the API and restarting it recovers the subscription within 5s.

### Phase 6 — Invite system + cleanup (1 day)
1. Port `accept_invite` RPC to the new schema.
2. Add `revoked_at` column (addresses CODE_REVIEW P0-2).
3. Make sure new-user provisioning creates a `user_profiles` row (port the existing trigger).
4. Remove `VITE_BACKEND` flag if prod migration isn't happening this pass; otherwise keep it for cutover.

### Phase 7 — Ubuntu deploy via podman (1–2 days)
1. Prod `compose.yml`: `db` (with a real volume + daily `pg_dump` sidecar), `api`, `web` (nginx for the built SPA), `caddy` (TLS + reverse proxy).
2. Point Caddyfile at your domain. Caddy handles Let's Encrypt automatically.
3. Systemd unit that `podman-compose up -d` on boot — `systemctl enable --now dig-tracker.service`.
4. CI: existing GitHub Actions workflow builds images and pushes to a registry (ghcr.io); a deploy step SSHes to the Ubuntu box and `podman pull && podman-compose up -d`.
5. Backups: `pg_dump` sidecar → rclone to object storage, daily. Test restore monthly.
6. CORS: tighten to your domain only (today's `*` origin becomes unsafe once cookies are involved).

**Checkpoint:** staging URL serves the app end-to-end over HTTPS.

### Phase 8 — Prod cutover & Supabase retirement (½ day; only if migrating prod data)
1. Maintenance window: put Supabase frontend in read-only.
2. `pg_dump --data-only --schema=public` from Supabase → transform → `psql` into new DB. The transform maps `auth.users.id` → `public.users.id` (same UUIDs are fine) and adds missing profile rows for any user without one.
3. Flip DNS / env.
4. Keep Supabase project alive in read-only mode for 2 weeks as rollback.
5. Delete `supabase/` folder, drop `@supabase/supabase-js`, remove `VITE_BACKEND` flag.

**Rough total (Phases 0–7, local-dev-complete + prod-ready but not migrated):** 8–11 working days. Phase 8 adds ½–1 day if/when you decide to migrate prod data.

---

## 4. Risk analysis

Ordered by overall severity (likelihood × impact).

### R1 — Auth is where security incidents live. **High** (reduced from Critical since round-1 scope is small).
Reduced auth still has attack surface: cookie flags, CSRF, session-fixation, cross-board access via forged GUC. But with no password hashing, no email flow, and no token refresh in round 1, the surface is a fraction of a full impl.

**Mitigations:**
- HttpOnly + Secure + SameSite=Lax cookies from day one, even in dev (use `localhost` TLS via mkcert).
- Rate-limit `/auth/*` endpoints.
- `SET LOCAL app.user_id = …` inside a transaction per request — never a session-level `SET` (leaks across pool connections).
- Integration test: every endpoint hit unauthenticated returns 401; every endpoint with a forged `app.user_id` still honors RLS.
- Ugrade to a real auth library (Lucia / Better-Auth) in round 2, before inviting users outside your team.

### R2 — Realtime drift between tabs. **High.**
A hand-rolled LISTEN/NOTIFY → WebSocket fan-out has subtle failure modes: backend restart drops subscriptions, NOTIFY payload has an 8KB limit, reconnection logic on the client matters. Users will notice missing updates before you do.

**Mitigations:**
- Keep a periodic refetch as safety net (30s).
- Emit only row IDs via NOTIFY; backend refetches the row. Avoids the 8KB issue.
- Client reconnect-with-resync on WS close.
- Ship realtime behind a flag; tolerate a week of "refresh to see updates" if needed.

### R3 — Self-managed Ubuntu box. **High.**
Your own server means you own: TLS cert renewal, kernel patches, podman upgrades, disk full, Postgres backups. Failure modes are silent until they bite.

**Mitigations:**
- Caddy handles TLS renewal (automatic, no cron).
- Postgres in a container but on a dedicated named volume — `pg_dump` sidecar running daily, piped to rclone → object storage (e.g. Backblaze B2 at pennies/month).
- `watchtower` or a simple `unattended-upgrades` config for the host.
- `systemctl enable podman-auto-update.timer` for container updates.
- Uptime monitor (UptimeRobot free tier) pinging `/healthz`.
- Document a 10-minute "rebuild the box" runbook in the repo — if nothing else, it forces you to confirm backups actually restore.

### R4 — RLS stops working silently. **High.**
RLS depends on `auth.uid()`. If the backend forgets to set `app.user_id` on one code path, RLS still "passes" (because the GUC is null, and a NULL-based policy may pass or deny inconsistently). Worst case: a forgotten middleware on one endpoint lets any user read any row.

**Mitigations:**
- Default the GUC to a sentinel that fails every policy (`'00000000-0000-0000-0000-000000000000'::uuid`) when unauthenticated.
- Integration test: hit every endpoint unauthenticated; all must return 401/empty.
- Keep belt-and-braces checks in route handlers — don't rely on RLS alone.

### R5 — Data migration from Supabase. **Medium.**
`auth.users` rows must map to `public.users`. Existing sessions/JWTs become invalid. Users with active sessions get logged out during cutover. Task numbers, FKs, timestamps must preserve exactly.

**Mitigations:**
- Dry-run against staging with a real dump.
- Write migration SQL that's idempotent and resumable.
- Announce the cutover window; keep it short (target < 15 min).
- All users re-sign-in after cutover — expected.

### R6 — Scope creep in the backend layer. **Medium.**
Every PostgREST feature we used without thinking (`.select('a, b, nested(*)')`, ordering, filters) is now code we write. Easy to under-estimate.

**Mitigations:**
- Inventory every `.from(...)` call before starting Phase 2 (I can produce this list on request).
- Resist adding features; stick to what's used today.
- Don't rebuild PostgREST. Just expose exactly the queries the app makes.

### R7 — Test suite regression. **Medium.**
The mock emulates supabase-js. Rewriting it risks tests passing when the real thing fails — or vice versa.

**Mitigations:**
- Add integration tests hitting a real local Postgres *before* swapping the mock — so we have a second signal.
- Consider switching mocks to MSW (HTTP-level) — matches the new reality more faithfully.

### R8 — Magic-link UX loss (if 4a chosen). **Medium.**
Dropping magic link means password resets, forgot-password flows, new registration UX.

**Mitigations:**
- Accept the UX hit as a temporary state; ship magic link in a follow-up.
- Or use 4c which usually has magic link built-in.

### R9 — Email deliverability (if 4b chosen). **Low–Medium.**
DNS records, SPF/DKIM, provider onboarding all take time. Emails land in spam.

**Mitigations:**
- Use a transactional provider from day one (Resend or Postmark — fastest onboarding).
- Set up DKIM/SPF before Phase 4.

### R10 — Cost increase on small user base. **Low.**
Supabase free tier is generous. A VPS + managed Postgres + WS server is ~$20–40/mo minimum.

**Mitigations:**
- Use Fly.io's free tier or Hetzner CX11 (~€4/mo) + Fly Postgres.
- Be honest that "self-hosted" isn't free.

### R11 — Dev environment friction. **Low.**
"Just run the app" becomes "start Postgres, run migrations, start backend, start frontend."

**Mitigations:**
- A single `docker compose up` for DB + backend.
- One `npm run dev:all` that does everything with `concurrently`.

---

## 5. Features to disable (temporarily)

Ordered by when they return:

| Feature | Disabled in phase | Returns in phase | Fallback |
|---|---|---|---|
| Realtime board sync | Phase 3 | Phase 5 | 30s auto-refetch or manual refresh button |
| Magic link email | Phase 4 | Phase 4 (if 4b) or never (if 4a) | Dev-only login stub; password flow (4a) |
| Invite links | Phase 3 | Phase 6 | Manual board member add via admin script |
| Prod deployment | Phase 3 | Phase 7 | Dev/staging only during Phases 3–6 |
| Comment realtime badges | Phase 3 | Phase 5 | Refetch on tab focus |

During the dev-only period (Phases 1–6) the prod Supabase site keeps serving real users — you're building the replacement in parallel, not mid-flight.

---

## 6. Decided vs. still open

### Decided
| # | Decision | Answer |
|---|---|---|
| 1 | Architecture | **Option B** — drop Supabase |
| 2 | Backend runtime | **Node 22 + Fastify + pg + ws** (proposal, matches existing `node:22-alpine` Containerfile) |
| 3 | Host | Your Ubuntu cloud server |
| 4 | Packaging | **podman-compose** — extends existing `Containerfile` / `podman-compose.yml` |

### Round-1 auth proposal (please confirm)

You said "reduce auth needs for the first round." Options in order of minimality:

- **Auth-R1-A — Display-name login, no email verification.** User types a name, backend creates or looks up a `public.users` row, issues an HttpOnly session cookie. Zero email, zero password, zero external deps. Trust is 100% "you're on the link, you're in." Suitable for a small private team behind the login.
- **Auth-R1-B — Email + password, local only.** Standard bcrypt-based auth. Email is just an identifier, no verification email sent. One extra form field, argon2/bcrypt, that's it.
- **Auth-R1-C — Shared secret / passphrase for the whole board.** Single password env-var; anyone with it can sign in with any display name. Simplest for a "family board" use case.

All three map to the same cookie + GUC plumbing, so round 2 (proper magic link or library-backed auth) is a drop-in replacement.

**❓ Decision needed:** A, B, or C?

### Prod migration scope

**❓ Decision needed:** which of these are we building toward?

- **Scope-1 — Local dev only.** Phases 0–6. Prod stays on Supabase forever (or until a future decision). Lowest risk. ~6–8 days.
- **Scope-2 — Self-hosted deploy, fresh data.** Phases 0–7. Stand up the Ubuntu pod, don't migrate existing Supabase data — start clean. Suitable if current data is disposable. ~8–10 days.
- **Scope-3 — Self-hosted deploy, migrate existing data.** Phases 0–8. The full thing. ~9–11 days. Cutover window + rollback plan required.

### Timeline

**❓ Decision needed:** Any hard deadline? If not, recommend shipping **Scope-1** first, using it locally for a week, *then* deciding on Scope-2 or -3.

---

## 7. Recommendation

Given "reduced auth, own Ubuntu box, pod-based":

1. **Start with Scope-1 + Auth-R1-A.** Gets you a running local pod in ~a week; all features that matter for development work; zero external deps (no SMTP, no auth library).
2. **Dogfood it for a week.** You'll discover the real rough edges of your own backend before anyone else does.
3. **Decide on Scope-2 vs. Scope-3** based on whether prod data is worth migrating.
4. **Round-2 auth happens when you want to invite people outside your trust boundary** — not before.

Do not cut over prod on the first pass. A week-old bug quietly corrupting multi-user data is far more expensive than a delayed migration.

---

*Decisions locked. Phases 0 → 6 are in scope. Starting with Phase 0.*
