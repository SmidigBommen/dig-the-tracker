# Release operations

Slice 10 provides Space export, request logging, drain behavior, backup and restore commands, and monitoring checks. On 2026-09-16 the operator confirmed that no off-server backup exists. The scripts are ready; production backup scheduling, storage, alerts, and retention still need configuration. The recovery targets are at most 24 hours of data loss and four hours to restore service.

## Export a Space

A Space administrator opens Manage Space and chooses Download JSON. Archived Spaces can also be exported. `/export/space-v1.schema.json` describes version 1. The snapshot includes retained work, current comment text and tombstones, history, membership display names, invitation metadata, and administrative audit. References use identifiers generated for that download. Account identifiers, sessions, invitation secrets, private notifications, and internal database IDs are excluded. Export is not a database backup and has no import action.

Downloads use a consistent database snapshot, fetch rows in batches of 250, and recheck access between batches. Revoked access stops the stream. There are two concurrent downloads per process and a two-minute deadline. A failed or interrupted download must be retried; the browser only saves a completed response. Avoid downloading exports onto shared devices because they contain team content.

## Configure off-server backups

Use a private S3-compatible bucket outside the application server. Enable encryption at rest and require HTTPS. Use a dedicated writer credential restricted to `dig/`; keep recovery credentials separately so server loss does not also lose bucket access. Store OIDC configuration and the session secret in the operator's password manager. PostgreSQL dumps contain the whole database, including session and identity records, unlike Space exports.

1. Install Node 22, AWS CLI, and PostgreSQL 16 client tools on the operator host. Alternatively set `PG_TOOLS_CONTAINER` to the Coolify PostgreSQL container. The scripts run `pg_dump`, `pg_restore`, and `psql` inside it without publishing a database port. In that mode the database URL uses the address reachable inside that container, normally `127.0.0.1:5432`. Update the container name after replacement.
2. Put this checkout at `/opt/dig`. Create `/etc/dig` and `/var/lib/dig-operations` with mode 0700. Copy [the environment template](../ops/backup.env.example) to `/etc/dig/backup.env`, fill its values, and set mode 0600. AWS credentials and PostgreSQL passwords stay in environment variables, not command arguments or logs.
3. Apply [the lifecycle rules](../ops/s3-backup-lifecycle.json) to the dedicated bucket using its provider console. They expire `dig/daily/` after 14 days and `dig/monthly/` after 366 days. Check equivalent provider behavior before applying them. With bucket versioning, configure noncurrent-version expiry too, since ordinary expiration does not remove retained previous versions. [S3 expiration behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).
4. Install [dig-backup.service](../ops/dig-backup.service) and [dig-backup.timer](../ops/dig-backup.timer) under `/etc/systemd/system`. Run `systemctl daemon-reload`, then `systemctl start dig-backup.service`. Confirm both the dump and checksum exist in the bucket and that `backup-state.json` has a fresh completion time. The first successful backup in each UTC month creates the monthly copy, including after missed runs.
5. Download and restore that first off-server copy into an isolated database using the procedure below. Only then run `systemctl enable --now dig-backup.timer`. The timer runs daily at 01:00 UTC and catches up after downtime. Connect unit failure and the freshness check to the operator's alert service.

The backup script writes a private temporary custom-format dump, verifies its table of contents, uploads it and a SHA-256 sidecar, and updates its state only after all required uploads succeed. Temporary local dumps are removed after success or failure. Retention belongs to the bucket, not to the writer process. Backups can retain a deleted Space until normal expiry.

## Restore service

Use a trusted backup from this installation. Create an empty PostgreSQL 16 database owned by the application role. Keep it isolated from the running application until verification finishes. Download the selected `.dump` and its matching `.sha256` sidecar into a private directory, then run `sha256sum --check NAME.dump.sha256` from that directory.

Set `RESTORE_DATABASE_URL` through the operator's protected environment. It must name the empty recovery database. Set `PG_TOOLS_CONTAINER` if using containerized PostgreSQL tools.

```sh
npm run db:restore -- /private/recovery/NAME.dump
```

The restore command refuses an existing database with user tables, views, or sequences. It uses `pg_restore --single-transaction --exit-on-error --no-owner --no-acl`, so an error rolls back the restore and the destination role owns restored objects. Roles and infrastructure configuration must already exist. [PostgreSQL restore options](https://www.postgresql.org/docs/16/app-pgrestore.html).

Start the matching application image against the recovered database with the saved runtime configuration. Startup validates migration checksums before readiness succeeds. Verify sign-in, Space membership, archived work, Task history and comments, and creating and moving a Task. Confirm numbering continues without collisions. If restoring after a security incident, rotate relevant credentials and invalidate recovered browser sessions before reopening service.

For cutover, stop writes to the damaged installation, preserve its database for investigation, update Coolify to the verified recovery database, and redeploy the matching image. Check external HTTPS and readiness, then admit users. Record the selected backup time, recovery start, and service-restored time to measure both recovery targets. Do not run `db:reset` or restore over production.

## Quarterly restore drill

Each quarter, retrieve an actual off-server backup and complete the isolated restore above. Record object key, checksum, backup age, image revision, data checks, elapsed recovery time, and operator. A local round trip alone does not test bucket access or recovery after server loss.

For development and CI, `test:recovery` creates a new database, dumps a disposable source, restores it, validates migrations, compares fingerprints of every table and sequence, and proves that a second restore refuses to overwrite it. It then deletes only its generated recovery database and dump. The source must be quiescent during comparison.

```sh
DIG_RECOVERY_TEST=1 DATABASE_URL=postgres://dig:dig-test@127.0.0.1:55432/dig \
  PG_TOOLS_CONTAINER=dig-slice10-postgres npm run test:recovery
```

The 2026-09-16 local drill restored 100,482 rows across 24 tables from a 3,396,059-byte archive in 4.008 seconds. This used disposable PostgreSQL 16 and included 100,000 retained Tasks. It proves the local restore path; production download time and cutover are still unmeasured.

## Health, alerts, and logs

`GET /health/live` checks the Node process. `GET /health/ready` checks completed startup and PostgreSQL connectivity. Startup applies checksummed transactional migrations under a database advisory lock; an altered applied migration or failed migration prevents listening.

Run `node scripts/check-operations.mjs` every five minutes with the protected environment. It checks external HTTPS, readiness including PostgreSQL, at least 10% free space on `DIG_DATA_PATH`, and backup completion within 24 hours. It emits JSON and exits nonzero if any check fails. The backup timestamp advances only after successful uploads; it does not prove the objects still exist, so restore drills must verify retrieval. Set the data path to the filesystem containing the actual database volume.

Connect nonzero results and backup unit failures to the operator's monitoring service. Also place an external HTTPS/readiness monitor outside Hetzner so server loss raises an alert. Verify delivery with a deliberate failed check before marking monitoring complete. The repository does not provision an alert account or send messages.

HTTP logs contain server-generated request IDs, route categories, method, status, duration, and completion state. They omit raw paths, query strings, request bodies, cookies, tokens, and exception messages. Responses return `X-Request-Id` for support. Startup, migration, maintenance, backup, and shutdown logs have fixed event names. Operational logs expire after 30 days; Space audit follows the Space lifetime.

Configure a host collector with 30-day retention before release. One option is Docker's `journald` logging driver with persistent journal storage, `MaxRetentionSec=30day`, and an explicit disk quota. Set the application's log driver through the deployment configuration and verify collection after redeployment. Account for other services before changing host-wide journal settings. [Docker journald configuration](https://docs.docker.com/engine/logging/drivers/journald/).

## Runtime limits and deployment

The single-replica server limits authentication POSTs to 120 per five minutes per socket peer and other POSTs to 300 per minute per session. It returns 429 with `Retry-After`. Forwarded client addresses are not trusted; clients behind the Coolify proxy share its authentication budget. Reads, health probes, and existing live streams do not consume these buckets. Limits are process-local and reset on restart.

On SIGTERM or SIGINT, readiness fails, new mutations and exports receive 503, and live clients receive `server-draining`. Active HTTP downloads may finish within the 30-second deadline. The server then closes PostgreSQL. Compose allows 35 seconds before forcing termination; configure at least that grace in Coolify. Existing changes commit or roll back through their transactions.

Use [Coolify deployment guidance](coolify-deployment.md) for runtime secrets, private database networking, and HTTPS. The same `Containerfile` supplies local Compose and production. Compatible migrations can roll out normally; incompatible migrations require a maintenance window and a verified pre-deployment backup.

Release completion still requires a deployment of this revision, a successful off-server restore, verified operator alerts and log retention, and manual keyboard/screen-reader and current/previous browser checks. Automated Chromium, Firefox, WebKit, phone, and axe checks are recorded in [Slice 10 notes](implementation/slice-10-release-readiness.md).
