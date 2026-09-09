import type { BoardModule } from '../../modules/board/board-module.js'
import type { SpaceModule } from '../../modules/space/space-module.js'
import type { AuthenticatedIdentity } from '../../modules/identity/identity-module.js'
import type { TaskReference } from '../../contracts/board.js'
import type { SpaceKey,TaskKey } from '../../modules/shared.js'

// Each target Space gets its own capability and Board transaction, retaining the lock order.
export async function foreignReferences(modules: { space: SpaceModule; board: BoardModule },identity: AuthenticatedIdentity,
  currentKey: SpaceKey,keys: TaskKey[]): Promise<TaskReference[]> {
  const groups = new Map<SpaceKey,TaskKey[]>()
  for (const key of keys) {
    const target = key.split('-')[0] as SpaceKey
    if (target !== currentKey) groups.set(target,[...(groups.get(target) ?? []),key])
  }
  const references: TaskReference[] = []
  for (const [spaceKey,group] of groups) {
    const access = await modules.space.authorize(identity,{ space: { kind: 'key',spaceKey },use: 'board-read' })
    if (!access.ok) continue
    const result = await modules.board.read(access.value,{ kind: 'references',keys: group })
    if (result.ok && result.value.kind === 'references') references.push(...result.value.value)
  }
  return references
}
