# Separate identity and Space access with transactional rechecks

Dig keeps OpenID Connect and sessions behind `IdentityModule`, and invitations, membership, roles, Space lifecycle, and authorization behind `SpaceModule`. `SpaceModule` returns an opaque request-scoped `AuthorizedSpace`, but each Board transaction privately rechecks that evidence and locks access state against concurrent revocation. This was chosen over one combined access Module and transaction-owning callbacks because it preserves clear, deep Interfaces without allowing stale authorization to commit a Board change.
