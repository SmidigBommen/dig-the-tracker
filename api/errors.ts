export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export function isDatabaseConstraintError(error: unknown): error is { code: string; constraint?: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
}
