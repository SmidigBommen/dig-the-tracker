import { readFile } from 'node:fs/promises'
import { test,expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('keyboard Task flow, themes, accessible views, and a private Space export', async ({ page,context },info) => {
  const fixtures = JSON.parse(await readFile('.test-artifacts/browser-sessions.json','utf8'))
  const fixture = fixtures[info.project.name]
  await context.addCookies([{ name: 'dig_session',value: fixture.cookie,domain: '127.0.0.1',path: '/',httpOnly: true,sameSite: 'Lax' }])
  const errors: string[] = []
  page.on('pageerror',error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('button',{ name: 'New Task',exact: true })).toBeVisible()
  const scan = async () => {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()
    expect(result.violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await scan()
  await page.getByRole('button',{ name: 'New Task',exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('textbox',{ name: 'Title',exact: true }).fill('Release check by keyboard')
  await page.getByRole('button',{ name: 'Create Task',exact: true }).click()
  const task = page.getByRole('button',{ name: new RegExp(`${fixture.key}-1`) })
  await expect(page.getByRole('dialog')).toBeVisible()
  await scan()
  const column = page.getByRole('combobox',{ name: 'Column',exact: true })
  await column.selectOption({ label: 'In Progress' })
  await expect(page.getByText('All changes saved',{ exact: true })).toBeVisible()
  await page.getByRole('textbox',{ name: 'Comment',exact: true }).fill('Browser and keyboard checks passed')
  await page.getByRole('button',{ name: 'Post comment',exact: true }).click()
  await expect(page.getByText('Browser and keyboard checks passed',{ exact: true })).toBeVisible()
  await expect(column).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(task).toBeVisible()
  await page.getByRole('button',{ name: 'Personal menu' }).click()
  await page.getByRole('button',{ name: 'Appearance',exact: true }).click()
  for (const palette of info.project.name === 'chromium' ? ['Nature','Neutral','Tokyo Night'] : ['Tokyo Night']) {
    await page.getByRole('radio',{ name: palette,exact: true }).check()
    for (const mode of ['Light','Dark']) {
      await page.getByRole('radio',{ name: mode,exact: true }).check()
      await expect(page.getByText('Appearance saved',{ exact: true })).toBeVisible()
      await scan()
    }
  }
  await page.keyboard.press('Escape')
  for (const name of ['Search','Flow','Workload']) { await page.getByRole('tab',{ name,exact: true }).click();await scan() }
  await page.getByRole('button',{ name: 'Manage Space',exact: true }).click()
  await page.getByRole('heading',{ name: 'Members',exact: true }).waitFor()
  await scan()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button',{ name: 'Download JSON',exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toMatch(new RegExp(`^${fixture.key}-.*\\.json$`))
  const exported = JSON.parse(await readFile((await download.path())!,'utf8'))
  expect(exported).toMatchObject({ schemaVersion: 1,space: { key: fixture.key } })
  expect(exported.tasks[0].title).toBe('Release check by keyboard')
  expect(exported.comments[0].text).toBe('Browser and keyboard checks passed')
  expect(JSON.stringify(exported)).not.toContain(fixture.cookie)
  expect(errors).toEqual([])
})
