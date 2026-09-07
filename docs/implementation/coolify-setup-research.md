# Coolify setup research

Checked official Coolify documentation on 2026-09-07. These settings describe a single Dig application and a separate PostgreSQL resource. No deployment or account changes were performed during this research. Examples use `tracker.example.com`; replace it with the chosen hostname.

## Application settings

| Coolify setting | Value |
|---|---|
| Source | `SmidigBommen/dig-the-tracker` through a GitHub App or deploy key |
| Branch | `master`, once the deployment changes are pushed there |
| Build Pack | `Dockerfile` |
| Base Directory | `/` |
| Dockerfile Location | `/Containerfile` |
| Target build stage | Leave empty to use the final `runtime` stage |
| Ports Exposes | `8080` |
| Ports Mappings | Empty |
| Domains | `https://tracker.example.com` |
| Static site | Disabled |
| Pre/Post-deployment commands | Empty when startup applies migrations |

Coolify supports repository-owned Dockerfiles, a custom path relative to the base directory, and an explicit internal listening port. Its model normalizes Dockerfile locations with a leading slash. [Dockerfile deployment](https://next.coolify.io/docs/applications/builds/dockerfile), [Application model](https://github.com/coollabsio/coolify/blob/main/app/Models/Application.php).

The repository's [Containerfile](../../Containerfile) builds both the browser and API, serves the browser files through Node, and binds `0.0.0.0:8080`. It already sets `NODE_ENV=production`, `ALLOW_CONTAINER_BIND=true`, and `STATIC_DIR=/app/dist`. No separate frontend resource is needed.

Enter the domain with `https://` to request automatic TLS configuration. Point the hostname's DNS at the deployment server and verify the resulting certificate in the browser. With one exposed application port, the domain can omit a port. An explicit `https://tracker.example.com:8080` also selects container port 8080; visitors still use ordinary HTTPS on 443. [Domains](https://coolify.io/docs/knowledge-base/domains), [General configuration](https://next.coolify.io/docs/applications/configuration/general).

## Private PostgreSQL

Create PostgreSQL as a standalone Coolify resource on the same server **and the same destination** as Dig. A destination identifies a Docker network; two resources in the same project or on the same server can still use different networks. [Destinations](https://coolify.io/docs/knowledge-base/destinations).

Set the initial database and username to `dig`, retain a generated password, and start PostgreSQL before deploying Dig. Leave database Ports Mappings empty and public accessibility disabled. Copy the database's generated Internal URL into Dig's `DATABASE_URL` without replacing its hostname with `localhost` or the server IP. The internal URL works when both containers share the destination network. Coolify gives standalone databases persistent volumes. [Database deployment and connections](https://next.coolify.io/docs/databases/).

No particular destination name can be prescribed before inspecting the instance. Confirm the selected destination on both resources. A standard destination provides connectivity to its other attached containers; it does not imply a network dedicated exclusively to this application. If the existing instance uses separate networks, assign both resources to one suitable destination instead of enabling a public database port.

## Runtime configuration and OIDC

For each application variable, enable Runtime Variable and disable Build Variable. Both flags default to enabled in current documentation. Use Literal for values containing `$` that must remain unchanged. These settings are in the normal variable editor. [Environment variables](https://coolify.io/docs/knowledge-base/environment-variables).

```dotenv
DATABASE_URL=<copy the PostgreSQL Internal URL>
SESSION_SECRET=<one stable random secret of at least 32 characters>
OIDC_ISSUER=https://identity.example.com
OIDC_CLIENT_ID=<provider client ID>
OIDC_CLIENT_SECRET=<provider client secret, if applicable>
OIDC_REDIRECT_URI=https://tracker.example.com/api/auth/callback
INSTALLATION_ADMIN_SUBJECTS=<your exact provider sub claim>
ALLOWED_ORIGINS=https://tracker.example.com
COOKIE_SECURE=true
```

Register the callback above with the identity provider. The application reads these variables at runtime, requires HTTPS for the production issuer and callback, and identifies installation administrators by exact issuer and subject. The callback origin is automatically allowed; setting `ALLOWED_ORIGINS` explicitly documents the intended browser origin. `OIDC_SCOPES` is optional. [Application configuration](../../api/config.ts), [OIDC adapter](../../api/adapters/oidc/production-oidc-adapter.ts), [Project README](../../README.md).

## First deployment and readiness

The original container command starts the server without migrating. The local Compose setup handles this with a separate migration service. Before using the standalone deployment described here, ensure container startup runs `node api-dist/migrate.js up` successfully before serving traffic. Avoid `npm run db:migrate` in the production image because that script invokes the development TypeScript compiler. [Local Compose](../../podman-compose.yml), [Migration entry point](../../api/migrate.ts), [Package scripts](../../package.json).

Coolify's pre-deployment command runs inside the existing container and is skipped when no existing container is available. Its post-deployment command runs after deployment is marked successful. Neither is a suitable first-deployment readiness gate. [Dockerfile deployment commands](https://next.coolify.io/docs/applications/builds/dockerfile).

Use a real readiness endpoint that checks PostgreSQL, then probe it inside the container with HTTP on port 8080. Suggested timing is a 30-second interval, five-second timeout, three retries, and 60-second start period. Adjust the start period if migrations need longer. A Dockerfile `HEALTHCHECK` takes precedence over the dashboard check. Dashboard HTTP checks need `curl` or `wget` in the final image; an image-owned Node probe can use the Node runtime already present. [Health checks](https://coolify.io/docs/knowledge-base/health-checks).

With Traefik, failed checks remove a container from routing. The newer documentation notes that the dashboard's expected response code/text fields are not currently compared by its generated HTTP probe, so return an HTTP error status on readiness failure. Check the deployed image's probe directly in the Coolify terminal. [Current health-check behavior](https://next.coolify.io/docs/applications/configuration/health-checks).

## GitHub access

Prefer an existing Coolify GitHub App installed for the `SmidigBommen` organization, granting access to this repository. If one must be created, use Sources, Add, and the automated installation flow. Select Private Repository with GitHub App when creating the application. Automatic deployments require GitHub to reach the configured Coolify webhook endpoint. [GitHub App setup](https://coolify.io/docs/applications/ci-cd/github/setup-app).

A read-only deploy key is an alternative scoped to this repository. Configure its public key in GitHub repository settings and its private key in Coolify, then use the SSH repository URL `git@github.com:SmidigBommen/dig-the-tracker.git`. [Deploy key setup](https://coolify.io/docs/applications/ci-cd/github/deploy-key).

The exact Coolify version, chosen domain, database image, destination, and identity provider remain instance-specific. Several detailed configuration pages currently live on the official `next.coolify.io` documentation site; compare their field names with the installed dashboard. Browser sign-in and Space creation still need an end-to-end check after deployment.
