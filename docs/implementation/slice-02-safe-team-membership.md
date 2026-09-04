# Slice 2: safe team membership

Status: implemented on 2026-09-04.

Slice 2 lets an administrator invite a second authenticated person into a Space and manage access without trusting browser-held authorization. It also makes archive, restore, and deletion scheduling available in the running browser.

## Delivered behavior

- Seven-day invitation links with single-use acceptance, revocation, expiry, replay protection, and one concealed invalid-invitation fault.
- SHA-256 invitation-secret digests in PostgreSQL. Idempotent issuance reconstructs the secret from its stable invitation ID and the server HMAC key instead of storing the raw value.
- Member promotion, demotion, removal, and voluntary leave with version checks and the last-administrator rule.
- Session rotation for the current browser after a permission change, revocation of other affected sessions, and session clearing when an identity loses all access and is not an installation administrator.
- Idempotent mutation receipts never persist or replay a raw browser-session replacement secret. A retry receives an unchanged-session directive after the original response has delivered the one-time replacement.
- Immutable administrative audit for invitation, Member, and Space-lifecycle changes. Ended Member rows retain attribution.
- Space display-name and IANA time-zone settings.
- Read-only archive, restore, seven-day deletion scheduling, and cancellation. Permanent deletion remains Slice 7 work.
- Opaque, Space-scoped cursors for Members, invitations, and audit entries.
- An optional access-invalidation port that publishes membership and lifecycle revisions after the owning transaction commits. Slice 6 connects it to live Board feeds.
- Browser views for invitation acceptance, invitation links, Members, roles, invitation state, access audit, Space settings, and lifecycle controls.
- Separate continuation controls for Member, invitation, and audit pages, with each opaque cursor carried through the HTTP Adapter independently.

## Concurrency and authorization

`AuthorizedSpace` remains request-scoped evidence. `BoardModule.read` locks and rechecks the Space, Member, browser session, requested use, lifecycle, and access revision inside PostgreSQL. Integration tests race Board reads against Member removal and Space archive. A read may finish before the access change, or it may be denied after it. An old capability never succeeds once the access change commits.

All Space changes use identity-scoped request IDs and stored receipts. PostgreSQL locks serialize lifecycle and membership rules. Inaccessible cross-Space Member IDs return the same not-found result as unknown IDs.

The running team path does not expose Task creation or assignment until Slice 3, so Member removal cannot yet encounter an assigned open Task. Slice 3 must add Board-owned unassignment inside the membership transaction before assignment becomes reachable; preserved ended-Member rows already retain historical attribution.

## Verification

`api/modules/slice-two.integration.test.ts` exercises invitation, membership, role, session, lifecycle, paging, audit, invalidation, concurrency, and HTTP behavior through the public Module Interfaces and disposable PostgreSQL. `src/test/TeamApp.test.tsx` covers invitation issue and acceptance, Space management, Member changes, session replacement, lifecycle controls, archived reload, and voluntary leave.

Public deployment remains blocked by the later team-release gates.
