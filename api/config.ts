const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export interface AppConfig {
  host: string
  port: number
  databaseUrl: string
  actorId: string
  boardId: string
  allowedOrigins: Set<string>
  staticDir: string | null
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

  return {
    host,
    port,
    databaseUrl: env.DATABASE_URL ?? 'postgres://dig:dig-local-only@127.0.0.1:5432/dig',
    actorId: env.LOCAL_ACTOR_ID ?? '00000000-0000-4000-8000-000000000001',
    boardId: env.LOCAL_BOARD_ID ?? '00000000-0000-4000-8000-000000000010',
    allowedOrigins: new Set((env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim())),
    staticDir: env.STATIC_DIR ?? null,
  }
}
