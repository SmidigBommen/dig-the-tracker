import type { AuthenticatedIdentity } from './identity/identity-module.js'
import type { AuthorizedSpace, SpaceUse } from './space/space-module.js'
import type {
  AccessRevision,
  IdentityId,
  MemberId,
  SessionId,
  SpaceId,
} from './shared.js'

interface IdentityClaims {
  sessionId: SessionId
  identityId: IdentityId
  oidcIssuer: string
  oidcSubject: string
  displayName: string
  installationAdministrator: boolean
  absoluteExpiresAt: Date
}

interface AuthorizedSpaceClaims {
  sessionId: SessionId
  identityId: IdentityId
  memberId: MemberId
  spaceId: SpaceId
  use: SpaceUse
  accessRevision: AccessRevision
}

const identities = new WeakMap<object, IdentityClaims>()
const spaces = new WeakMap<object, AuthorizedSpaceClaims>()

export function makeAuthenticatedIdentity(claims: IdentityClaims): AuthenticatedIdentity {
  const identity = Object.freeze({}) as AuthenticatedIdentity
  identities.set(identity, claims)
  return identity
}

export function inspectAuthenticatedIdentity(identity: AuthenticatedIdentity): IdentityClaims | undefined {
  return identities.get(identity)
}

export function makeAuthorizedSpace<P extends SpaceUse>(claims: AuthorizedSpaceClaims): AuthorizedSpace<P> {
  const access = Object.freeze({}) as AuthorizedSpace<P>
  spaces.set(access, claims)
  return access
}

export function inspectAuthorizedSpace(access: AuthorizedSpace): AuthorizedSpaceClaims | undefined {
  return spaces.get(access)
}
