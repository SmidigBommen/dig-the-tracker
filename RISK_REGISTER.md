# Risk register through Slice 2

Status: accepted for loopback development. Public deployment remains blocked until the team-release gates pass.

| Risk | Current control | Remaining gate |
|---|---|---|
| A caller forges identity | The server maps a verified OpenID Connect issuer and subject to an internal identity. The browser receives only an opaque server-session secret. | Test the configured production provider before deployment. Add operational sign-in rate limits. |
| OpenID Connect callback substitution or replay | Sign-in attempts use single-use state, nonce, PKCE, a hashed browser secret, and ten-minute expiry. The production Adapter verifies issuer, audience, expiry, signature, subject, and nonce. | Add provider-specific failure fixtures and alerting for repeated failures. |
| A stolen or stale session remains useful | Dig stores only a session-secret hash. Sessions expire after five idle days or 30 absolute days. Sign-out revokes the row. Permission changes rotate the current session or revoke affected remote sessions. | Add operational session controls and alerts before release. |
| A cross-site request changes data | The HTTP Adapter allowlists Origins. Every authenticated change also requires an HMAC-derived CSRF token tied to the session. Cookies are HttpOnly and SameSite. | Keep production cookies Secure behind HTTPS and add proxy-configuration checks. |
| A caller selects another Space | Routes resolve membership through `SpaceModule`; browser identifiers cannot construct `AuthorizedSpace`. `BoardModule` rechecks access inside its transaction. PostgreSQL race tests cover concurrent Member removal and archive. | Repeat the same recheck for every Board mutation added in later slices. |
| An invitation leaks or reveals its state | Dig returns the raw invitation secret once, stores only its digest, expires it after seven days, and maps unknown, expired, revoked, and consumed secrets to one fault. | Add invitation issuance rate limits before public release. |
| A Space loses its last administrator | Promotion, demotion, removal, and leave lock membership state and reject changes that would remove the last administrator. | Add recovery operations for installation operators before public release. |
| Two requests create the same Space or repeat a change | PostgreSQL reserves Space keys permanently. An identity/request advisory lock and stored receipt make Space creation idempotent. | Apply the same request contract to later Space and Board commands. |
| A cross-Space database relationship is inserted | Board Columns carry `space_id`; a composite foreign key requires their Board to belong to the same Space. Stable IDs own relationships. | Extend composite constraints to every Space-owned table in later slices. |
| Provider downtime locks out active Members | Session resolution never contacts the provider, so existing valid sessions continue. | Operators need provider health visibility; new sign-ins still wait for recovery by design. |
| Migration drift or concurrent migration corrupts setup | The runner records SHA-256 checksums, holds a PostgreSQL advisory lock, and applies migrations transactionally. | Finish startup readiness and incompatible-change procedures before release. |
| Dependency vulnerabilities reach production | Dependencies are locked and the image uses `npm ci`. | Resolve or explicitly accept production audit findings before the release slice. |
| The unfinished MVP is exposed publicly | Repository Compose publishes only on loopback, and documentation marks public deployment blocked. | Complete Task authorization, rate limits, supported-browser checks, backup restore, and every team-release gate. |

The retained public-schema Task prototype is not reachable through the running HTTP Adapter. Remove its tables and files in Slice 3 after equivalent `BoardModule` behavior tests pass.
