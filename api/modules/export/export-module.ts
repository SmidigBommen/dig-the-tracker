import type { Database } from '../../db.js'
import { inspectAuthorizedSpace } from '../private-capabilities.js'
import type { Result } from '../shared.js'
import type { AuthorizedSpace, SpaceFault } from '../space/space-module.js'
import { readSpaceExport } from '../space/private-export.js'

export type ExportChunk = { kind: 'data'; text: string } | { kind: 'failed'; fault: SpaceFault }
export interface SpaceExport { filename: string; chunks: AsyncIterable<ExportChunk> }
export interface SpaceExportModule {
  read(access: AuthorizedSpace<'space-export'>, signal?: AbortSignal): Promise<Result<SpaceExport,SpaceFault>>
}
export class SpaceExportModuleImplementation implements SpaceExportModule {
  constructor(private readonly db: Database) {}
  async read(access: AuthorizedSpace<'space-export'>, signal?: AbortSignal): Promise<Result<SpaceExport,SpaceFault>> {
    const claims = inspectAuthorizedSpace(access)
    if (!claims || claims.use !== 'space-export') return { ok: false,fault: { kind: 'forbidden' } }
    return readSpaceExport(this.db,claims,signal)
  }
}
