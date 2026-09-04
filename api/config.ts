const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const LOCAL_SESSION_SECRET = 'local-development-session-secret-change-me'

export interface OidcConfig {
  issuer: string
  clientId: string
  clientSecret?: string
  redirectUri: string
  scopes?: string
}

export interface AppConfig {
  host: string
  port: number
  databaseUrl: string
  allowedOrigins: Set<string>
  staticDir: string | null
  secureCookies: boolean
  sessionHmacSecret: string
  installationAdministrators: Set<string>
  oidc: OidcConfig | null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.API_HOST ?? '127.0.0.1'
  if (!LOOPBACK_HOSTS.has(host) && env.ALLOW_CONTAINER_BIND !== 'true') {
    throw new Error('Refusing non-loopback API_HOST without ALLOW_CONTAINER_BIND=true')
  }

  const port = Number(env.API_PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be a valid TCP port')
  }

  const production = env.NODE_ENV === 'production'
  const sessionHmacSecret = env.SESSION_SECRET ?? (production ? '' : LOCAL_SESSION_SECRET)
  if (sessionHmacSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')

  const oidc = oidcConfig(env)
  const defaultOrigins = production ? '' : 'http://localhost:5173,http://127.0.0.1:5173'
  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS ?? defaultOrigins)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  if (oidc) allowedOrigins.add(new URL(oidc.redirectUri).origin)
  const secureCookies = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production
  if (production && !secureCookies && (!oidc || !LOOPBACK_HOSTS.has(new URL(oidc.redirectUri).hostname))) {
    throw new Error('Secure cookies are required outside loopback development')
  }

  const installationAdministrators = new Set<string>()
  if (oidc) {
    for (const subject of (env.INSTALLATION_ADMIN_SUBJECTS ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
      installationAdministrators.add(`${oidc.issuer}|${subject}`)
    }
  }

  return {
    host,
    port,
    databaseUrl: env.DATABASE_URL ?? 'postgres://dig:dig-local-only@127.0.0.1:5432/dig',
    allowedOrigins,
    staticDir: env.STATIC_DIR ?? null,
    secureCookies,
    sessionHmacSecret,
    installationAdministrators,
    oidc,
  }
}

function oidcConfig(env: NodeJS.ProcessEnv): OidcConfig | null {
  const values = [env.OIDC_ISSUER, env.OIDC_CLIENT_ID, env.OIDC_REDIRECT_URI]
  if (values.every((value) => !value)) return null
  if (values.some((value) => !value)) {
    throw new Error('OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_REDIRECT_URI must be configured together')
  }

  const issuer = env.OIDC_ISSUER!
  const redirectUri = env.OIDC_REDIRECT_URI!
  if (new URL(issuer).protocol !== 'https:') throw new Error('OIDC_ISSUER must use HTTPS')
  const redirect = new URL(redirectUri)
  if (redirect.protocol !== 'https:' && env.NODE_ENV === 'production' && !LOOPBACK_HOSTS.has(redirect.hostname)) {
    throw new Error('OIDC_REDIRECT_URI must use HTTPS in production')
  }

  return {
    issuer,
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET || undefined,
    redirectUri,
    scopes: env.OIDC_SCOPES || undefined,
  }
}
