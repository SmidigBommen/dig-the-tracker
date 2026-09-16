# Slice 10: release readiness

Implemented on 2026-09-16 from the release slice in [the vertical plan](../design/vertical-slice-plan.md). Code and local verification are complete. Production rollout, off-server backup storage, alert delivery, log retention, and manual client checks remain release gates. The operator confirmed there is no existing off-server backup.

## Delivered behavior

Space administrators can download versioned JSON from Manage Space, including archived work. The separate `SpaceExportModule.read` returns a filename and typed stream. Private Space and Board readers retain ownership of their SQL. The export contains current records and retained history with local references; it excludes database/account identifiers, sessions, invitation secrets, private inboxes, and removed comment text. [The version 1 schema](../../public/export/space-v1.schema.json) is served with the application.

Exports use a consistent snapshot, 250-row cursor batches, fresh access checks between batches, two concurrent requests per process, and a two-minute deadline. Per-export salted HMAC identifiers keep memory bounded without exposing database keys. Session activity and revocation can proceed while a download is paused. Cancelled or failed streams close their snapshot and produce an incomplete HTTP response that the browser does not save.

HTTP responses carry server-generated request IDs. JSON logs contain route categories, status, timing, and completion state without user content or raw exception text. Authentication and mutation bursts return 429 with retry guidance. Shutdown refuses new changes and exports, closes live feeds, and drains existing requests for up to 30 seconds. An active export can complete during that grace period. Compose waits 35 seconds before termination.

Backup tooling creates custom PostgreSQL archives and restores only into empty destinations. The S3 writer uploads checksums, advances its success timestamp only after uploads, and catches up a monthly copy on the first successful run of each month. A systemd timer, bucket lifecycle rules, environment template, operations checker, and [recovery runbook](../operations.md) are included. Production configuration is deliberately recorded as pending.

Browser checks run the actual built application and PostgreSQL through Chromium, Firefox, WebKit, and a phone viewport. Only the external OIDC provider uses its test Adapter. They cover keyboard Task capture, explicit movement, comments, reload, reports, appearance palettes, Space administration, and downloaded JSON. Axe scans cover these views. The checks led to fixes for Column status semantics, the phone Space picker label, and dialog Escape behavior after focus leaves a disabled control.

CI now runs browser checks, a full-database restore drill, backup upload failure/catch-up checks, and an OCI image build after the existing lint, unit, database, and build gates. Browser failure artifacts exclude the fixture session file. Dependency updates removed the advisories found during this slice.

## Local evidence

| Check | Result |
|---|---|
| Regular Vitest suites | 81 tests passed across 18 files; database suites skipped in this run |
| Full PostgreSQL Module and HTTP suites | 100 tests passed across 18 files, including live delivery at 100 connections |
| Final export regression suite | Seven tests passed, including the added exhausted-pool case, active-download drain, access revocation, removed comments, schema/privacy, and 100,000 retained Tasks with 25 Members and 20 Spaces |
| Migration regression | Concurrent startup, transactional failure rollback, and applied-checksum rejection passed against an isolated database |
| Playwright | Four projects passed: Chromium, Firefox, WebKit, and phone; axe checks passed on covered views |
| Restore drill | 100,482 rows across 24 tables matched after restoring a 3,396,059-byte archive; all sequences matched; repeat restore refused to overwrite; 4.008 seconds locally |
| Backup writer | Real PostgreSQL dumps with a substituted external AWS CLI verified failed uploads preserve state, catch-up creates monthly objects, and later runs avoid duplicate monthly copies |
| OCI and Compose | Image built; fresh isolated Compose setup migrated and became ready; runtime UID 1000; SIGTERM logged drain/stop and exited 0 |
| Production read-only check | Existing deployment `/health/ready` returned 200; this does not verify a deployment of Slice 10 |

The 100,000-Task export is a scale fixture, not a production performance guarantee for maximum-length descriptions and comments. The restore timing excludes remote object retrieval and infrastructure provisioning. No production database was modified by these checks.

## Remaining release gates

- Deploy this revision through the existing push/auto-deploy workflow and verify sign-in, capture, movement, live recovery, export, and reload in production.
- Configure the off-server bucket, writer credentials, retention, and daily schedule. Retrieve an uploaded backup and restore it into an isolated database. Record total recovery time and backup age.
- Activate external availability checks, operator alerts, disk/backup-age checks, and 30-day operational log retention. Verify an alert reaches the operator.
- Complete manual keyboard and screen-reader checks and current/previous Chrome, Edge, Firefox, and Safari checks. Engine automation does not establish full WCAG conformance or cover every installed browser version. [Playwright accessibility guidance](https://playwright.dev/docs/accessibility-testing).

Two review passes checked the export against the specification and repository standards. Findings about long-held session locks, active-download drain, Module boundaries, streaming faults, identifier memory, pool exhaustion, and missed monthly runs were addressed. No import or product analytics were added.
