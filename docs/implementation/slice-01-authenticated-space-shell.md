# Slice 1: authenticated Space shell

Status: implemented on 2026-09-04.

Slice 1 replaces the running single-actor browser and HTTP path with an authenticated shell. The earlier Task files and prototype tables remain temporarily so their existing tests and uncommitted work are preserved until Slice 3 replaces that behavior.

## Delivered behavior

- OpenID Connect authorization-code sign-in with state, nonce, PKCE, discovery, signed ID-token verification, and one configured provider.
- PostgreSQL-backed browser sessions with hashed secrets, a five-day inactivity limit, a 30-day absolute limit, Origin checks, and HMAC-derived CSRF tokens.
- Installation-administrator configuration by stable OpenID Connect subject.
- Idempotent Space creation with immutable uppercase Space-key reservation.
- Atomic creation of the first Space administrator, unnamed Board, Backlog, In Progress with WIP limit 3, and Done.
- An opaque `AuthorizedSpace` created by `SpaceModule` and rechecked inside the Board read transaction.
- Browser states for sign-in, first-Space creation, Space selection, empty Board overview, reload, and sign-out.

Invitations, additional membership operations, Task behavior, live updates, archive behavior, reports, export, and production operating work remain in later slices.

## Runtime configuration

The server requires these values:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_REDIRECT_URI`
- `INSTALLATION_ADMIN_SUBJECTS`
- `SESSION_SECRET`, at least 32 characters

`OIDC_CLIENT_SECRET` is optional for providers using a public client. `OIDC_SCOPES` defaults to `openid profile email`. Production redirects and cookies require HTTPS. Local loopback Compose explicitly permits an HTTP callback and non-Secure cookie.

Copy `.env.example` to `.env` for Compose, register its callback URL with the provider, and replace every placeholder. Coolify supplies the same values as runtime-only variables and uses an HTTPS callback.

## Verification

`api/modules/slice-one.integration.test.ts` exercises the public Module Interfaces and the complete HTTP cookie flow against disposable PostgreSQL. `api/adapters/oidc/production-oidc-adapter.test.ts` verifies PKCE parameters and a signed provider token. `src/test/TeamApp.test.tsx` covers anonymous sign-in, first-Space creation, the default Board, and last-Space reload.
