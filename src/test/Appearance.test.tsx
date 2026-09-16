import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AppearanceMenu } from '../appearance/AppearanceMenu.tsx'
import { AppearanceSession } from '../appearance/appearance-session.ts'
import type { AppearanceView } from '../../api/contracts/appearance.ts'

it('chooses a palette and display mode by keyboard and restores focus to the personal menu', async () => {
  const values = new Map<string,string>()
  vi.stubGlobal('localStorage',{ getItem: (key: string) => values.get(key) ?? null,setItem: (key: string,value: string) => values.set(key,value) })
  let saved: AppearanceView = { identityId: 'ada',palette: 'nature',mode: 'system',revision: 0 }
  const session = new AppearanceSession({ read: async () => saved,save: async preference => { saved={ ...saved,...preference,revision:saved.revision+1 };return saved } })
  session.connect('ada','csrf')
  try {
    const user = userEvent.setup()
    render(<AppearanceMenu session={session} displayName="Ada" onSignOut={() => {}} busy={false} />)
    await waitFor(() => expect(session.getSnapshot().ready).toBe(true))
    const trigger = screen.getByRole('button',{ name: 'Personal menu' })
    await user.click(trigger)
    await user.click(screen.getByRole('button',{ name: 'Appearance' }))
    const nature = screen.getByRole('radio',{ name: /Nature/ })
    nature.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('radio',{ name: /Tokyo Night/ })).toBeChecked()
    await user.click(screen.getByRole('radio',{ name: 'Light' }))
    await waitFor(() => expect(saved).toMatchObject({ palette: 'tokyo-night',mode: 'light' }))
    expect(document.documentElement.dataset.palette).toBe('tokyo-night')
    expect(document.documentElement.dataset.scheme).toBe('light')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  } finally { session.stop();vi.unstubAllGlobals() }
})
