import { expect, test } from '@playwright/test'

test('profile and module management works in the 320px full-screen sheet', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')

  await page.getByRole('button', { name: 'Open menu' }).click()
  const manage = page.getByRole('button', { name: 'Manage', exact: true })
  await manage.click()
  const dialog = page.getByRole('dialog', { name: 'Profiles & opening modules' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('height', '800px')
  const managerCoversBoard = await page.evaluate(() => {
    const backdrop = document.querySelector<HTMLElement>('.profile-manager-backdrop')
    const board = document.querySelector<HTMLElement>('.board-wrapper')
    if (!backdrop || !board) return false
    const rect = board.getBoundingClientRect()
    const stack = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const managerIndex = stack.findIndex((element) => element === backdrop || backdrop.contains(element))
    const boardIndex = stack.findIndex((element) => element === board || board.contains(element))
    return managerIndex >= 0 && boardIndex >= 0 && managerIndex < boardIndex
  })
  expect(managerCoversBoard).toBe(true)

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyOverflow: document.body.style.overflow,
  }))
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)
  expect(dimensions.bodyOverflow).toBe('hidden')

  for (const labelText of ['New profile', 'New white opening module']) {
    const label = dialog.getByText(labelText, { exact: true })
    const box = await label.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(250)
    expect(box!.height).toBeLessThan(25)
    await expect(label).toHaveCSS('display', 'block')
    await expect(label).toHaveCSS('font-size', '14px')
  }

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
  expect(selectBox!.width).toBeGreaterThan(200)
  expect(manageBox!.width).toBeGreaterThan(200)
  expect(manageBox!.y).toBeGreaterThan(selectBox!.y)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})
