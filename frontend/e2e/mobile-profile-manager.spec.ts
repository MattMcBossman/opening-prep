import { expect, test } from '@playwright/test'

test('profile and module management works in the 360px full-screen sheet', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')

  const manage = page.getByRole('button', { name: 'Manage', exact: true })
  await manage.click()
  const dialog = page.getByRole('dialog', { name: 'Profiles & opening modules' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('height', '800px')

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyOverflow: document.body.style.overflow,
  }))
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)
  expect(dimensions.bodyOverflow).toBe('hidden')

  await page.getByLabel('New profile').fill('Phone tournament')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Phone tournament' })).toBeVisible()

  await page.getByRole('button', { name: 'Rename profile' }).click()
  await page.getByLabel('Profile name').fill('Phone blitz')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(dialog.getByRole('heading', { name: 'Phone blitz' })).toBeVisible()

  await page.getByLabel('New white opening module').fill('Caro Kann: an intentionally long module name')
  await page.getByRole('button', { name: 'Create module' }).click()
  const moduleCard = dialog.getByRole('article').filter({ hasText: 'Caro Kann: an intentionally long module name' })
  await expect(moduleCard).toContainText(/white\s*Personal/)
  await expect(moduleCard).toContainText('0 prepared lines')
  await expect(moduleCard).toContainText('0 saved moves')
  await expect(moduleCard.getByRole('button', { name: 'Editing this module' })).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(manage).toBeFocused()
  const editingSelect = page.locator('.repertoire-profile-controls label').filter({ hasText: /^Editing/ }).locator('select')
  await expect(editingSelect).toHaveValue(/\d+/)
  const [selectBox, manageBox] = await Promise.all([editingSelect.boundingBox(), manage.boundingBox()])
  expect(selectBox && manageBox).toBeTruthy()
  expect(Math.abs(selectBox!.y - manageBox!.y)).toBeLessThan(12)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})
