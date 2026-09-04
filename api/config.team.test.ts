// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('team runtime configuration', () => {
  it('maps configured provider subjects to stable installation-administrator identities', () => {
    const config = loadConfig({
      OIDC_ISSUER: 'https://identity.example.test/',
      OIDC_CLIENT_ID: 'dig',
      OIDC_REDIRECT_URI: 'https://dig.example.test/api/auth/callback',
      INSTALLATION_ADMIN_SUBJECTS: 'ada, grace',
      SESSION_SECRET: 'a-production-secret-with-at-least-32-characters',
      NODE_ENV: 'production',
    })

    expect(config.oidc?.issuer).toBe('https://identity.example.test/')
    expect(config.installationAdministrators).toEqual(new Set([
      'https://identity.example.test/|ada',
      'https://identity.example.test/|grace',
    ]))
    expect(config.allowedOrigins).toContain('https://dig.example.test')
    expect(config.allowedOrigins).not.toContain('http://localhost:5173')
    expect(config.secureCookies).toBe(true)
  })

  it('rejects partial provider configuration and weak production session secrets', () => {
    expect(() => loadConfig({ OIDC_ISSUER: 'https://identity.example.test' }))
      .toThrow('configured together')
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' }))
      .toThrow('at least 32')
    expect(() => loadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-production-secret-with-at-least-32-characters',
      COOKIE_SECURE: 'false',
      OIDC_ISSUER: 'https://identity.example.test',
      OIDC_CLIENT_ID: 'dig',
      OIDC_REDIRECT_URI: 'https://dig.example.test/api/auth/callback',
    })).toThrow('Secure cookies')
  })
})
