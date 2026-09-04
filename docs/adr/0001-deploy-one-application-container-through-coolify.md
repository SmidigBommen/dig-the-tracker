# Deploy one application container through Coolify

Dig ships as one OCI application image built from a repository-owned container definition. Local development uses Compose, while production runs one steady-state application replica through self-hosted Coolify on the Hetzner server, with PostgreSQL as a separate private Coolify database resource. This keeps one application artifact across environments, separates data and backups from application releases, and avoids adding orchestration that a small team does not need.
