import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { mockSupabase, resetMockData } from './supabaseMock.ts'

// Mock the supabase module
vi.mock('../lib/supabase', () => ({
  supabase: mockSupabase,
}))

afterEach(() => {
  // Clear hash between tests so hash-based routing doesn't leak
  window.location.hash = ''
  resetMockData()
})
