export type Result<T, F> =
  | { ok: true; value: T }
  | { ok: false; fault: F }

declare const scalarBrand: unique symbol

type Branded<Value, Name extends string> = Value & { readonly [scalarBrand]: Name }

export type AccessRevision = Branded<number, 'AccessRevision'>
export type AuditId = Branded<string, 'AuditId'>
export type BoardId = Branded<string, 'BoardId'>
export type ChangeSequence = Branded<number, 'ChangeSequence'>
export type ColumnId = Branded<string, 'ColumnId'>
export type CommentId = Branded<string, 'CommentId'>
export type IdentityId = Branded<string, 'IdentityId'>
export type Instant = Branded<string, 'Instant'>
export type InvitationId = Branded<string, 'InvitationId'>
export type LocalApplicationPath = Branded<string, 'LocalApplicationPath'>
export type MemberId = Branded<string, 'MemberId'>
export type NotificationId = Branded<string, 'NotificationId'>
export type OpaqueCursor = Branded<string, 'OpaqueCursor'>
export type OpaqueSecret = Branded<string, 'OpaqueSecret'>
export type RequestId = Branded<string, 'RequestId'>
export type Revision = Branded<number, 'Revision'>
export type SessionId = Branded<string, 'SessionId'>
export type SpaceId = Branded<string, 'SpaceId'>
export type SpaceKey = Branded<string, 'SpaceKey'>
export type TagId = Branded<string, 'TagId'>
export type TaskId = Branded<string, 'TaskId'>
export type TaskKey = Branded<string, 'TaskKey'>

export interface FieldIssue {
  field: string
  message: string
}

export type BrowserSessionDirective =
  | {
      kind: 'establish' | 'replace'
      sessionSecret: OpaqueSecret
      csrfToken: OpaqueSecret
      absoluteExpiresAt: Instant
    }
  | { kind: 'clear' }
  | { kind: 'unchanged' }

export interface IdentityView {
  id: IdentityId
  displayName: string
  installationAdministrator: boolean
}

export interface PageRequest {
  after?: OpaqueCursor
  size?: number
}

export function isDatabaseError(error: unknown): error is Error & { code: string } {
  return error instanceof Error
    && 'code' in error
    && typeof (error as Error & { code?: unknown }).code === 'string'
}
