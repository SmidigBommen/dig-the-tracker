import { describe, expect, it } from 'vitest'
import { BoardSession } from './board-session.ts'
import type { WorkflowView } from '../../api/contracts/board.ts'
import { emptyBoard, MemoryBoardTransport } from '../test/board-fixtures.ts'

const workflow: WorkflowView = { revision: 1 as never, columns: emptyBoard.columns.map((column) => ({ ...column, archived: false, taskCount: 0 })) }

describe('workflow session', () => {
  it('retains the workflow and request ID when a save response is uncertain', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'workflow', value: workflow, sequence: 0 as never }
    const session = new BoardSession(transport, emptyBoard)
    await session.openWorkflow()
    const desired = { columns: workflow.columns }
    transport.fault = { kind: 'temporarily-unavailable' }
    expect(await session.saveWorkflow(workflow.revision, desired)).toBe(false)
    expect(session.getSnapshot()).toMatchObject({ workflow, connected: false, pendingAction: true })
    transport.fault = undefined
    transport.receipt = { result: { kind: 'set-workflow' }, warnings: [], update: { sequence: 1 as never, occurredAt: '2026-09-09T12:00:00Z' as never,
      changes: [{ kind: 'workflow-replaced', workflow: { ...workflow, revision: 2 as never } }] } }
    session.setConnected(true)
    expect(await session.retryPendingChange()).toBe(true)
    expect(transport.requests[1]).toEqual(transport.requests[0])
    expect(session.getSnapshot().workflow).toBeUndefined()
    expect(session.getSnapshot().overview.board.workflowRevision).toBe(2)
  })

  it('updates live Columns without replacing an open workflow draft baseline', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'workflow', value: workflow, sequence: 0 as never }
    const session = new BoardSession(transport, emptyBoard)
    await session.openWorkflow()
    session.applyUpdate({ sequence: 1 as never, occurredAt: '2026-09-09T12:00:00Z' as never,
      changes: [{ kind: 'workflow-replaced', workflow: { revision: 2 as never, columns: workflow.columns.map((column) => ({ ...column, name: 'Ready' })) } }] })
    expect(session.getSnapshot().overview.columns[0].name).toBe('Ready')
    expect(session.getSnapshot().workflow).toEqual(workflow)
  })
})
