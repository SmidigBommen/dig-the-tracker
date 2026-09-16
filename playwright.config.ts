import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [['list'],['html',{ outputFolder: '.test-artifacts/playwright-report',open: 'never' }]],
  outputDir: '.test-artifacts/playwright-results',
  use: { baseURL: 'http://127.0.0.1:5180',trace: 'retain-on-failure',screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/e2e/server.mjs',url: 'http://127.0.0.1:5180/health/ready',reuseExistingServer: false,timeout: 60_000,stdout: 'ignore' },
  projects: [
    { name: 'chromium',use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',use: { ...devices['Desktop Safari'] } },
    { name: 'phone',use: { ...devices['iPhone 13'],defaultBrowserType: 'chromium',browserName: 'chromium' } },
  ],
})
