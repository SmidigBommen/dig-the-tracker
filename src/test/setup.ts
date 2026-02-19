import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

afterEach(() => {
  // Clear hash between tests so hash-based routing doesn't leak
  window.location.hash = ''
})
