import { createRemoteJWKSet, jwtVerify } from 'jose'
import type {
  OidcAuthorizationInput,
  OidcPort,
  OidcRedemptionInput,
  VerifiedExternalIdentity,
} from './oidc-port.js'
import { OidcRejectedError, OidcUnavailableError } from './oidc-port.js'

interface ProviderMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

interface TokenResponse {
  id_token?: string
  error?: string
}

export interface ProductionOidcConfig {
  issuer: string
  clientId: string
  clientSecret?: string
  scopes?: string
}

export class ProductionOidcAdapter implements OidcPort {
  private metadataPromise?: Promise<ProviderMetadata>

  constructor(private readonly config: ProductionOidcConfig) {}

  async begin(input: OidcAuthorizationInput): Promise<string> {
    const metadata = await this.metadata()
    const url = new URL(metadata.authorization_endpoint)
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', this.config.scopes ?? 'openid profile email')
    url.searchParams.set('state', input.state)
    url.searchParams.set('nonce', input.nonce)
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return url.toString()
  }

  async redeem(input: OidcRedemptionInput): Promise<VerifiedExternalIdentity> {
    const metadata = await this.metadata()
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.config.clientId,
      code_verifier: input.codeVerifier,
    })
    const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' })
    if (this.config.clientSecret) {
      const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')
      headers.set('authorization', `Basic ${credentials}`)
    }

    let response: Response
    try {
      response = await fetch(metadata.token_endpoint, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new OidcUnavailableError('The identity provider could not be reached', { cause: error })
    }

    const token = await response.json().catch(() => ({})) as TokenResponse
    if (!response.ok || token.error || !token.id_token) {
      throw new OidcRejectedError('The identity provider rejected the callback')
    }

    try {
      const verified = await jwtVerify(token.id_token, createRemoteJWKSet(new URL(metadata.jwks_uri)), {
        issuer: metadata.issuer,
        audience: this.config.clientId,
      })
      if (verified.payload.nonce !== input.nonce || typeof verified.payload.sub !== 'string') {
        throw new OidcRejectedError('The identity token did not match the sign-in attempt')
      }
      const displayName = [verified.payload.name, verified.payload.preferred_username, verified.payload.email, verified.payload.sub]
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0)!
      return {
        issuer: metadata.issuer,
        subject: verified.payload.sub,
        displayName: displayName.trim().slice(0, 100),
        email: typeof verified.payload.email === 'string' ? verified.payload.email : null,
      }
    } catch (error) {
      if (error instanceof OidcRejectedError) throw error
      throw new OidcRejectedError('The identity token could not be verified', { cause: error })
    }
  }

  private metadata(): Promise<ProviderMetadata> {
    if (!this.metadataPromise) {
      this.metadataPromise = this.loadMetadata().catch((error: unknown) => {
        this.metadataPromise = undefined
        throw error
      })
    }
    return this.metadataPromise
  }

  private async loadMetadata(): Promise<ProviderMetadata> {
    const issuer = this.config.issuer
    const discoveryBase = issuer.replace(/\/$/, '')
    let response: Response
    try {
      response = await fetch(`${discoveryBase}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new OidcUnavailableError('The identity provider could not be reached', { cause: error })
    }
    if (!response.ok) throw new OidcUnavailableError('The identity provider discovery document was unavailable')
    const value = await response.json() as Partial<ProviderMetadata>
    if (value.issuer !== issuer || !value.authorization_endpoint || !value.token_endpoint || !value.jwks_uri) {
      throw new OidcUnavailableError('The identity provider discovery document was invalid')
    }
    for (const endpoint of [value.authorization_endpoint, value.token_endpoint, value.jwks_uri]) {
      if (new URL(endpoint).protocol !== 'https:') throw new OidcUnavailableError('Identity provider endpoints must use HTTPS')
    }
    return value as ProviderMetadata
  }
}
