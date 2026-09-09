import type { Database } from '../db.js'
import { archiveDueTasks } from '../modules/board/private-retention.js'
import { deleteDueSpaces } from '../modules/space/private-deletion.js'

export async function runMaintenanceOnce(db: Database, now = new Date(), installationAdministrators: ReadonlySet<string> = new Set()) {
  const deletedSpaces = await deleteDueSpaces(db, now, installationAdministrators)
  const archivedTasks = await archiveDueTasks(db, now)
  return { deletedSpaces, archivedTasks }
}

export function startMaintenance(db: Database, installationAdministrators: ReadonlySet<string>, report: (result: { deletedSpaces: number; archivedTasks: number } | undefined) => void) {
  let stopped = false
  let running: Promise<void> | undefined
  const tick = () => {
    if (stopped || running) return
    running = runMaintenanceOnce(db, new Date(), installationAdministrators).then(report, () => report(undefined)).finally(() => { running = undefined })
  }
  const timer = setInterval(tick, 60_000)
  timer.unref()
  tick()
  return async () => { stopped = true; clearInterval(timer); await running }
}
