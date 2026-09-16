/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      '^/api/(?!contracts/)': 'http://127.0.0.1:3001',
    },
  },
  test: {
    exclude: ['tests/e2e/**','node_modules/**','dist/**','.test-artifacts/**'],
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
