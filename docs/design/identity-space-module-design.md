# Identity and Space Module design

Status: selected. Slice 1 implements sign-in, sessions, Space creation and selection, and Board-read authorization. The remaining Space command grammar belongs to later slices.

## Design problem

`IdentityModule` must establish a server session without spreading OpenID Connect or cookie rules through the application. `SpaceModule` must own invitations, membership, roles, Space lifecycle, and authorization without making callers reproduce those rules.

The difficult case is concurrent revocation. A Member can lose access after a route authorizes the Space but before `BoardModule` commits a change. A request-scoped capability is therefore evidence to recheck, not a bearer permission that bypasses current PostgreSQL state.

## Designs considered

### Separate Identity and Space Modules

`IdentityModule` resolves an opaque authenticated identity. `SpaceModule` uses it for Space reads and changes and creates an opaque `AuthorizedSpace`. `BoardModule` rechecks that capability through a private transactional Seam.

This has the best caller-facing Locality. Sign-in changes remain inside `IdentityModule`; invitation and Space-lifecycle changes remain inside `SpaceModule`; Board behavior remains inside `BoardModule`. The cost is private Implementation coupling around session revocation, Space creation, Member removal, and transactional access checks.

### One combined Access Module

A single `AccessModule` can make session and permission changes naturally atomic. It also groups unrelated reasons for change—OpenID Connect behavior and Space lifecycle—behind one large command grammar. It still needs the same private transaction recheck in `BoardModule`, so combining the Interfaces does not remove the hardest Seam.

### Transaction-owning Space Module

`SpaceModule` can own each database transaction and invoke Board work through a transaction-bound callback. This gives the strongest visible concurrency model, but transaction lifetime and callback restrictions leak into callers and require changing the selected `BoardModule` Interface. It provides less Depth for ordinary routes and browser-facing work.

## Selected arrangement

Use separate `IdentityModule` and `SpaceModule` Interfaces. Keep their shared PostgreSQL coordination private to the server assembly. Do not introduce a caller-facing authorization engine, permission checker, repository Interface, or transaction callback.

```text
HTTP and Server-Sent Events Adapter
├── IdentityModule
│   └── OpenID Connect port
├── SpaceModule
│   └── creates AuthorizedSpace
└── BoardModule
    └── privately rechecks AuthorizedSpace in PostgreSQL transactions
```

## IdentityModule Interface

```ts
export interface IdentityModule {
  signIn(
    request: SignInRequest,
  ): Promise<Result<SignInReceipt, IdentityFault>>

  session(
    request: SessionRequest,
  ): Promise<Result<SessionReceipt, IdentityFault>>
}

export type SignInRequest =
  | { kind: 'begin'; returnTo?: LocalApplicationPath }
  | {
      kind: 'complete'
      callback: OidcCallbackParameters
      attemptSecret: OpaqueSecret
    }

export type SessionRequest =
  | {
      kind: 'resolve'
      evidence: SessionEvidence
      use: 'read' | 'change' | 'stream'
    }
  | {
      kind: 'end'
      evidence: SessionEvidence
      requestId: RequestId
    }
```

A successful `resolve` returns an opaque `AuthenticatedIdentity` and any browser-session directive. Browser input cannot construct, inspect, serialize, or reuse `AuthenticatedIdentity` outside the request or stream-opening attempt.

```ts
export type BrowserSessionDirective =
  | {
      kind: 'establish' | 'replace'
      sessionSecret: OpaqueSecret
      csrfToken: OpaqueSecret
      absoluteExpiresAt: Instant
    }
  | { kind: 'clear' }
  | { kind: 'unchanged' }
```

`IdentityModule` owns:

- OpenID Connect state, nonce, PKCE correlation, callback verification, and the mapping from stable issuer and subject to Dig identity;
- hashed session secrets, rotation, revocation, and the five-day inactivity and 30-day absolute limits;
- Origin and CSRF checks appropriate to read, change, and stream use;
- installation-administrator configuration checks;
- safe session establishment, replacement, clearing, and sign-out directives.

Resolving a valid session never contacts the identity provider. Provider display names and email addresses are attributes, not stable identity. The HTTP Adapter owns cookie parsing, fixed Secure/HttpOnly/SameSite attributes, redirects, and transport status codes.

OpenID Connect is a true-external dependency behind one port with a production Adapter and a deterministic test Adapter:

```ts
export interface OidcPort {
  begin(input: OidcAuthorizationInput): Promise<OidcAuthorization>
  redeem(input: OidcRedemptionInput): Promise<VerifiedExternalIdentity>
}
```

PostgreSQL, time, ID generation, and entropy stay inside the Implementation. PostgreSQL is local-substitutable and is exercised through the `IdentityModule` Interface in isolated-database tests.

## SpaceModule Interface

```ts
export interface SpaceModule {
  read(
    identity: AuthenticatedIdentity,
    query: SpaceQuery,
  ): Promise<Result<SpaceView, SpaceFault>>

  change(
    identity: AuthenticatedIdentity,
    request: SpaceChangeRequest,
  ): Promise<Result<SpaceChangeReceipt, SpaceFault>>

  authorize<P extends SpaceUse>(
    identity: AuthenticatedIdentity,
    request: AuthorizeSpaceRequest<P>,
  ): Promise<Result<AuthorizedSpace<P>, SpaceFault>>
}

export type SpaceUse =
  | 'board-read'
  | 'board-change'
  | 'board-follow'
  | 'space-audit-read'
  | 'space-export'

export type SpaceQuery =
  | { kind: 'switcher'; include: 'active' | 'archived' | 'all'; page?: PageRequest }
  | { kind: 'space'; space: SpaceLocator }
  | { kind: 'members'; space: SpaceLocator; page?: PageRequest }
  | { kind: 'invitations'; space: SpaceLocator; page?: PageRequest }
  | { kind: 'audit'; space: SpaceLocator; page?: PageRequest }

export interface SpaceChangeRequest {
  requestId: RequestId
  command: SpaceCommand
}

export interface SpaceChangeReceipt {
  result: SpaceCommandResult
  session: BrowserSessionDirective
  accessRevision: AccessRevision
}

export type SpaceCommand =
  | { kind: 'create-space'; input: CreateSpace }
  | { kind: 'revise-space'; space: VersionedSpace; changes: SpaceChanges }
  | { kind: 'issue-invitation'; space: SpaceLocator }
  | { kind: 'revoke-invitation'; space: SpaceLocator; invitationId: InvitationId }
  | { kind: 'accept-invitation'; invitationSecret: OpaqueSecret }
  | { kind: 'set-member-role'; space: SpaceLocator; member: VersionedMember; role: MemberRole }
  | { kind: 'remove-member'; space: SpaceLocator; member: VersionedMember }
  | { kind: 'leave-space'; space: SpaceLocator }
  | { kind: 'archive-space'; space: VersionedSpace }
  | { kind: 'restore-space'; space: VersionedSpace }
  | { kind: 'schedule-space-deletion'; space: VersionedSpace }
  | { kind: 'cancel-space-deletion'; space: VersionedSpace }
```

`SpaceModule` owns:

- installation-administrator-only Space creation and atomic creation of its unnamed default Board;
- permanent Space-key reservation;
- invitation generation, digest storage, seven-day expiry, revocation, and single-use acceptance;
- membership and role changes, including the last-Space-administrator rule;
- preserved former-Member attribution and atomic unassignment of their open Tasks;
- permission-change session rotation or revocation through private Identity operations;
- Space archive, restore, deletion scheduling, cancellation, and post-grace deletion;
- immutable administrative audit records;
- access revisions and Board-stream invalidation;
- idempotency for all changes.

Every paged query uses an opaque cursor, defaults to 50 entries, and caps at 200. Inaccessible Space and Member identifiers return the same `not-found` fault. Unknown, expired, revoked, and consumed invitation secrets return the same `invalid-invitation` fault.

An `AuthorizedSpace<P>` is opaque and request-scoped. It carries private session, identity, Space, membership, use, and access-revision evidence. Callers can pass it only to an Interface entry that accepts its `SpaceUse`; they cannot inspect it to make their own authorization decisions.

## Concurrent access rule

Initial authorization never substitutes for a transaction-time check.

Inside every Board read or change transaction, the Board Implementation uses a private access Implementation to recheck the session, membership, requested use, Space lifecycle, and access revision. It locks the Space, membership, and session rows in one documented order. Membership and lifecycle changes take conflicting locks in the same order.

- If the Board transaction obtains the locks first, it may commit before the later revocation or archive operation.
- If the access change obtains the locks first, the Board transaction returns `forbidden` or `read-only`.
- A Board change cannot begin after a completed revocation by presenting an older capability.

A live feed holds no long-running database locks. `follow` rechecks access when opening, whenever an access-revision invalidation arrives, and on each heartbeat. Revocation or Space archive publishes invalidation after commit and closes the affected feed. The heartbeat bounds recovery if an invalidation is missed.

The transactional recheck is a private Seam between the Space and Board Implementations. HTTP routes, React views, and ordinary Interface tests never receive it. Tests obtain real `AuthenticatedIdentity` and `AuthorizedSpace` values through the public Modules rather than casting or constructing them.

## Cross-Module transactions

Some Space changes require Board effects. Space creation installs the default workflow. Removing a Member unassigns their open Tasks. Archiving or deleting a Space terminates its feed and affects its retained Board state.

The Space Implementation coordinates those effects through private Board operations in the same PostgreSQL transaction. These operations are not additional entries on `BoardModule`; exposing them would let callers bypass Space rules and weaken both Modules. Integration tests exercise the complete public operation through `SpaceModule.change`.

Space changes can also require Identity effects. Invitation acceptance, role changes, Member removal, and leaving update access revisions in the same transaction. When the current browser's permissions change, the receipt carries a replacement session directive. Other sessions for an affected identity are revoked because their unknown browser secrets cannot be rotated remotely. Losing all Space access revokes every session unless the identity remains a configured installation administrator. These are private operations of the Identity Implementation, not extra `IdentityModule` entries available to routes.

If this private coordination grows beyond these lifecycle effects, revisit the Seam instead of exposing PostgreSQL transactions or creating a generic internal command bus.

## Fault contracts

Expected faults cross each Seam as typed values. The common shapes are `not-authenticated`, `invalid`, `not-found`, `forbidden`, `read-only`, `conflict`, `rule-violation`, `rate-limited`, and `temporarily-unavailable`; each Module narrows reasons to behavior it owns.

PostgreSQL errors, provider payloads, cookies, HTTP statuses, and stack traces never cross these Seams. Unexpected Implementation defects may throw and are translated to an internal failure by the HTTP Adapter.

## Depth and testing

The deletion test is strong for both Modules. Removing `IdentityModule` would scatter provider verification, session security, CSRF, and expiry. Removing `SpaceModule` would scatter invitation state, role and lifecycle invariants, access revisions, audit writes, and authorization.

Tests run through the public Interfaces against isolated PostgreSQL. OpenID Connect tests replace only the true-external port. HTTP Adapter tests cover parsing, cookies, redirects, and safe fault mapping. Concurrency tests deliberately race Board changes with Member removal and Space archive. Old repository and pass-through tests are removed only after equivalent Interface tests exist.
