import { act,render,screen } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import { TaskClaimBadge } from '../agents/TaskClaim.tsx'
import type { TaskClaim } from '../../api/contracts/board.ts'
import type { MemberId } from '../../api/modules/shared.ts'

afterEach(()=>vi.useRealTimers())
it('removes an expired claim on an idle Board and reschedules after renewal',()=>{
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-17T10:00:00Z'))
  const claim:TaskClaim={id:'claim',runId:'run',connectionId:'connection',connectionName:'Codex',member:{id:'member' as MemberId,displayName:'Ada'},startedAt:'2026-09-17T09:00:00Z',lastCheckInAt:'2026-09-17T09:00:00Z',expiresAt:'2026-09-17T10:01:00Z'}
  const view=render(<TaskClaimBadge claim={claim} />)
  expect(screen.getByText('Agent claim · Codex')).toBeVisible()
  view.rerender(<TaskClaimBadge claim={{...claim,expiresAt:'2026-09-17T10:02:00Z'}} />)
  act(()=>vi.advanceTimersByTime(60010))
  expect(screen.getByText('Agent claim · Codex')).toBeVisible()
  act(()=>vi.advanceTimersByTime(60000))
  expect(screen.queryByText('Agent claim · Codex')).toBeNull()
  view.rerender(<TaskClaimBadge claim={claim} />)
  expect(screen.queryByText('Agent claim · Codex')).toBeNull()
})
