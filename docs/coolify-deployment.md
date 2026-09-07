# Coolify and OpenID Connect setup

This setup deploys the current Space and membership app so its real OpenID Connect sign-in can be verified before Task development resumes. It does not complete the remaining team-release work in Slice 9. The selected Coolify dashboard is `https://coolify.smidigbommen.no`; Dig will use `https://dig.smidigbommen.no` with Microsoft Entra. A Coolify project already exists; its application, database, and HTTPS configuration still need to be verified.

## Prepare the resources

1. Point the chosen Dig hostname at the Coolify deployment server.
2. Create a PostgreSQL 16 resource with a persistent volume. Use database `dig`, user `dig`, and a generated password. Start it and keep public access disabled.
3. Create an application from `SmidigBommen/dig-the-tracker` through Coolify's GitHub App or a read-only deploy key. Use the same server and destination network as PostgreSQL.
4. Select a commit containing the startup and health-check changes described here. A local working-tree change is unavailable to Coolify until pushed.

| Application setting | Value |
|---|---|
| Build Pack | Dockerfile |
| Base Directory | `/` |
| Dockerfile Location | `/Containerfile` |
| Target build stage | Empty |
| Ports Exposes | `8080` |
| Ports Mappings | Empty |
| Domain | `https://dig.smidigbommen.no` |
| Static site | Disabled |
| Pre/Post-deployment commands | Empty |

The image runs as the `node` user and serves both the browser and API. Startup validates configuration, applies checksummed migrations under the PostgreSQL migration lock, and then opens port 8080. A failed migration prevents startup. The image's health check calls `/health/ready`; `/health/live` reports that the HTTP process is running. Readiness requires startup completion and a working database connection, and becomes unavailable during shutdown. Database connection attempts time out after five seconds; readiness queries time out after two seconds.

Keep the image health check enabled. It runs every 30 seconds, allows ten seconds per probe, and has a 60-second startup allowance. No application volume or separate frontend resource is needed. Coolify terminates HTTPS and connects to the container over HTTP.

Coolify pre-deployment commands run in an existing container and skip the first deployment. Startup migrations therefore own database initialization. [Coolify Dockerfile deployment](https://next.coolify.io/docs/applications/builds/dockerfile), [Health checks](https://coolify.io/docs/knowledge-base/health-checks).

## Register the identity client

Create an OpenID Connect authorization-code client in the chosen provider:

- Redirect URI: `https://dig.smidigbommen.no/api/auth/callback`, exactly, with no trailing slash.
- Scopes: `openid profile email`.
- PKCE: S256.
- Confidential clients: token endpoint authentication `client_secret_basic`.
- Public clients: no client secret, if the provider permits this flow.
- Issuer: copy the exact `issuer` in the provider's discovery document, including any trailing slash or tenant path.

The current adapter supports HTTP Basic client authentication and public clients. Provider configurations that require `client_secret_post`, private-key JWT, or nonstandard issuer handling need an adapter change before deployment.

### Microsoft Entra

Use the application's Directory tenant ID to form `OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0`. Dig requires an exact issuer match, so use the tenant GUID rather than `common` or `organizations`. Microsoft's discovery document supplies the token and signing-key endpoints. [Microsoft OIDC discovery](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc#fetch-the-openid-configuration-document).

In Entra ID, open App registrations, select Dig-issue-tracker, then Authentication, Add redirect URI, and Web. Dig's Node server redeems the authorization code using its client secret. Register `http://localhost:8080/api/auth/callback` for local Docker testing, then add the chosen HTTPS callback for Coolify. Use the same hostname to open Dig and in `OIDC_REDIRECT_URI` so the callback receives the sign-in attempt cookie. [Entra redirect configuration](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).

The portal accepts HTTP callbacks with `localhost`; HTTP with `127.0.0.1` requires a manifest edit. This is why the Entra local example uses `localhost`. [Microsoft loopback restrictions](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#prefer-127001-over-localhost).

Local Docker reads `.env` through Compose. With the callback above and credentials configured, run:

```sh
docker compose -p dig-entra-local -f podman-compose.yml up --build -d --wait
```

Open `http://localhost:8080`. This Compose project owns its own `dig-postgres` volume. An empty `INSTALLATION_ADMIN_SUBJECTS` allows the first sign-in without granting Space creation; set your application's verified `sub` afterward as described below. For Vite development, the server instead reads `.env.local` and the callback uses port 5173.

## Set runtime variables

Enable Runtime Variable and disable Build Variable for every value below. Use Coolify's literal-value option where a value contains `$`. [Coolify environment variables](https://coolify.io/docs/knowledge-base/environment-variables).

```dotenv
DATABASE_URL=<PostgreSQL resource's Internal URL>
SESSION_SECRET=<stable random secret>
OIDC_ISSUER=<exact discovery issuer>
OIDC_CLIENT_ID=<registered client ID>
OIDC_CLIENT_SECRET=<client secret, or empty for a public client>
OIDC_REDIRECT_URI=https://dig.smidigbommen.no/api/auth/callback
INSTALLATION_ADMIN_SUBJECTS=<your exact provider sub claim>
ALLOWED_ORIGINS=https://dig.smidigbommen.no
COOKIE_SECURE=true
```

Use the database's Internal URL unchanged, with its private hostname. The application and database must share a destination network. Do not substitute `localhost` or publish PostgreSQL to make connectivity work. [Coolify destinations](https://coolify.io/docs/knowledge-base/destinations), [Database connections](https://next.coolify.io/docs/databases/).

Generate the session secret locally with `openssl rand -hex 32`, enter it directly in Coolify, and retain it across deployments. Enter the provider client secret directly in Coolify too. These values do not belong in Git or the browser build. CSRF and invitation signing derive from `SESSION_SECRET`; there is no separate CSRF configuration variable in this implementation.

`INSTALLATION_ADMIN_SUBJECTS` contains provider `sub` claims, not display names or email addresses. If the provider does not show the application's subject before sign-in, leave this variable empty for the first deployment. After signing in once, use the private database console to identify your own record:

```sql
select oidc_issuer, oidc_subject, display_name
from team.identities
order by created_at desc;
```

Copy only your verified subject into `INSTALLATION_ADMIN_SUBJECTS`, redeploy, and sign in again. An empty administrator list permits sign-in but does not permit Space creation. Provider subjects stay in operational configuration and the private database.

## Verify the deployment

1. Confirm the deployment log applies any pending migrations and then reports `server-listening` on port 8080. A second deployment must preserve the database and skip previously applied migrations.
2. Open `https://dig.smidigbommen.no/health/ready`. Expect HTTP 200 and `{"status":"ready"}`.
3. Open the application, sign in through the actual provider, and confirm the callback returns to Dig. Check that the session cookie is Secure, HttpOnly, and SameSite=Lax.
4. As an installation administrator, create a disposable Space. Confirm Backlog, In Progress with WIP limit 3, and Done.
5. Reload and confirm the session and selected Space survive. Sign out, then confirm authenticated API access returns 401.

If sign-in fails, check the exact issuer, callback, client authentication method, and outgoing HTTPS access to the provider's discovery, token, and JWKS endpoints. An Origin error usually means the browser hostname differs from `ALLOWED_ORIGINS` or the callback origin. An unhealthy container needs its migration or database connection error resolved before provider troubleshooting.

Live provider sign-in, the remote deployment, and its backup setup remain unverified until these steps are performed. The broader release work remains in [the vertical-slice plan](design/vertical-slice-plan.md). See [Coolify research](implementation/coolify-setup-research.md) for sources and configuration details.

## Local verification

Verified on 2026-09-07 with Docker Desktop, the Node 22 application image, and disposable PostgreSQL 16:

- The image built and became healthy after applying all three migrations to an empty database.
- The browser entry returned 200; anonymous `/api/session` returned 401.
- Restarting the application skipped the applied migrations and resumed serving.
- Stopping PostgreSQL changed readiness to 503 while liveness stayed 200 and the process remained running.
- All 82 regular tests and 28 database integration tests passed; lint and the production build passed.
- The production dependency audit reported no known vulnerabilities. The build's development dependency audit reported advisories; those remain separate release work.

The local container used a placeholder issuer, so these checks do not establish compatibility with the real provider.
