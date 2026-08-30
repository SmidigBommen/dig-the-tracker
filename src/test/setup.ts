import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { mockApi, resetMockData } from './apiMock.ts'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>()
  return { ...actual, api: mockApi }
})

afterEach(() => {
  // Clear hash between tests so hash-based routing doesn't leak
  if (typeof window !== 'undefined') window.location.hash = ''
  resetMockData()
})
