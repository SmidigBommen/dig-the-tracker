// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ProductionOidcAdapter } from './production-oidc-adapter.js'

const issuer = 'https://identity.example.test'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('production OpenID Connect Adapter', () => {
  it('uses authorization code flow with PKCE and verifies the returned identity token', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    const idToken = await new SignJWT({ nonce: 'expected-nonce', name: 'Ada Admin', email: 'ada@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience('dig-client')
      .setSubject('ada')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        })
      }
      if (url === `${issuer}/token`) {
        expect(init?.body).toBeInstanceOf(URLSearchParams)
        expect((init?.body as URLSearchParams).get('code_verifier')).toBe('verifier')
        return Response.json({ id_token: idToken })
      }
      if (url === `${issuer}/jwks`) return Response.json({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] })
      return new Response(null, { status: 404 })
    }))

    const adapter = new ProductionOidcAdapter({ issuer, clientId: 'dig-client', clientSecret: 'client-secret' })
    const authorizationUrl = new URL(await adapter.begin({
      state: 'state', nonce: 'expected-nonce', codeChallenge: 'challenge', redirectUri: 'https://dig.example.test/callback',
    }))
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('code_challenge')).toBe('challenge')

    const identity = await adapter.redeem({
      code: 'code', nonce: 'expected-nonce', codeVerifier: 'verifier', redirectUri: 'https://dig.example.test/callback',
    })
    expect(identity).toEqual({
      issuer,
      subject: 'ada',
      displayName: 'Ada Admin',
      email: 'ada@example.test',
    })
  })

  it('rejects a token issued for another sign-in nonce', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    const idToken = await new SignJWT({ nonce: 'other-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience('dig-client')
      .setSubject('ada')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input.toString()
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        })
      }
      if (url === `${issuer}/token`) return Response.json({ id_token: idToken })
      return Response.json({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] })
    }))

    const adapter = new ProductionOidcAdapter({ issuer, clientId: 'dig-client' })
    await expect(adapter.redeem({
      code: 'code', nonce: 'expected-nonce', codeVerifier: 'verifier', redirectUri: 'https://dig.example.test/callback',
    })).rejects.toThrow('did not match')
  })

  it('retries discovery after the identity provider recovers', async () => {
    let discoveryAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      discoveryAttempts += 1
      if (discoveryAttempts === 1) throw new Error('provider offline')
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      })
    }))

    const adapter = new ProductionOidcAdapter({ issuer, clientId: 'dig-client' })
    await expect(adapter.begin({
      state: 'first-state', nonce: 'first-nonce', codeChallenge: 'first-challenge', redirectUri: 'https://dig.example.test/callback',
    })).rejects.toThrow('could not be reached')

    await expect(adapter.begin({
      state: 'second-state', nonce: 'second-nonce', codeChallenge: 'second-challenge', redirectUri: 'https://dig.example.test/callback',
    })).resolves.toContain(`${issuer}/authorize`)
    expect(discoveryAttempts).toBe(2)
  })
})
