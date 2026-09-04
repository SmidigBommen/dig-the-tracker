import { createHash } from 'node:crypto'
import type {
  OidcAuthorizationInput,
  OidcPort,
  OidcRedemptionInput,
  VerifiedExternalIdentity,
} from './oidc-port.js'
import { OidcRejectedError } from './oidc-port.js'

export class MockOidcAdapter implements OidcPort {
  readonly authorizationInputs: OidcAuthorizationInput[] = []
  readonly redemptionInputs: OidcRedemptionInput[] = []

  constructor(private readonly identity: VerifiedExternalIdentity) {}

  async begin(input: OidcAuthorizationInput): Promise<string> {
    this.authorizationInputs.push(input)
    const url = new URL(`${this.identity.issuer}/authorize`)
    url.searchParams.set('state', input.state)
    url.searchParams.set('nonce', input.nonce)
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('redirect_uri', input.redirectUri)
    return url.toString()
  }

  async redeem(input: OidcRedemptionInput): Promise<VerifiedExternalIdentity> {
    this.redemptionInputs.push(input)
    if (input.code !== 'accepted-code') throw new OidcRejectedError('The provider rejected the code')
    const expectedChallenge = this.authorizationInputs.at(-1)?.codeChallenge
    const actualChallenge = createHash('sha256').update(input.codeVerifier).digest('base64url')
    if (!expectedChallenge || actualChallenge !== expectedChallenge) {
      throw new OidcRejectedError('The PKCE verifier did not match the authorization request')
    }
    return { ...this.identity }
  }
}
