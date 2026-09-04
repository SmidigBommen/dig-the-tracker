export interface OidcAuthorizationInput {
  state: string
  nonce: string
  codeChallenge: string
  redirectUri: string
}

export interface OidcRedemptionInput {
  code: string
  nonce: string
  codeVerifier: string
  redirectUri: string
}

export interface VerifiedExternalIdentity {
  issuer: string
  subject: string
  displayName: string
  email: string | null
}

export interface OidcPort {
  begin(input: OidcAuthorizationInput): Promise<string>
  redeem(input: OidcRedemptionInput): Promise<VerifiedExternalIdentity>
}

export class OidcUnavailableError extends Error {}
export class OidcRejectedError extends Error {}
