import { expect, test } from '@playwright/test'

test('viewing a managed module selects its color and returns drills to the explorer', async ({ page }) => {
  await page.route('**/api/v1/auth/session/', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false, user: null }),
  }))
  await page.addInitScript(() => {
    localStorage.setItem('opening-prep:board-color', 'white')
    localStorage.setItem('opening-prep:repertoire', JSON.stringify({
      version: 3,
      nextId: 4,
      activeProfileId: 1,
      editingModuleIds: { white: 2, black: 3 },
      profiles: [{ id: 1, name: 'Default', modules: [
        { moduleId: 2, enabled: true, sortOrder: 0 },
        { moduleId: 3, enabled: true, sortOrder: 1 },
      ] }],
      modules: [
        { id: 2, name: 'White module', color: 'white', tree: {} },
        { id: 3, name: 'Black module', color: 'black', tree: {} },
      ],
    }))
  })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Drills' }).click()
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  const blackModule = page.getByRole('article').filter({ hasText: 'Black module' })
  await blackModule.getByRole('button', { name: 'View module' }).click()

  await expect(page.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('switch', { name: 'Black module; switch to White' })).toBeVisible()
  await expect(page.locator('.repertoire-profile-controls label').filter({ hasText: /^Viewing/ }).locator('select')).toHaveValue('3')
})

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

  await dialog.getByRole('button', { name: 'Manage profiles' }).click()
  for (const labelText of ['New profile', 'New opening module']) {
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

  await page.getByLabel('New module color').selectOption('white')
  await page.getByLabel('New opening module').fill('Caro Kann: an intentionally long module name')
  await page.getByRole('button', { name: 'Create module' }).click()
  const moduleCard = dialog.getByRole('article').filter({ hasText: 'Caro Kann: an intentionally long module name' })
  await expect(moduleCard).toContainText(/white/i)
  await expect(moduleCard).toContainText('0 prepared lines')
  await expect(moduleCard).toContainText('0 saved moves')
  const detachButton = moduleCard.getByRole('button', { name: 'Detach from profile' })
  const viewButton = moduleCard.getByRole('button', { name: 'View module' })
  const duplicateButton = moduleCard.getByRole('button', { name: 'Duplicate' })
  const moreButton = moduleCard.getByRole('button', { name: 'More' })
  const [viewBox, duplicateBox, detachBox, moreBox] = await Promise.all([viewButton.boundingBox(), duplicateButton.boundingBox(), detachButton.boundingBox(), moreButton.boundingBox()])
  expect(viewBox && duplicateBox && detachBox && moreBox).toBeTruthy()
  expect(viewBox!.width).toBeGreaterThan(250)
  expect(duplicateBox!.width).toBeGreaterThan(250)
  expect(detachBox!.width).toBeGreaterThan(250)
  expect(moreBox!.width).toBeGreaterThan(250)
  expect(duplicateBox!.y).toBeGreaterThan(viewBox!.y)
  expect(detachBox!.y).toBeGreaterThan(duplicateBox!.y)
  expect(moreBox!.y).toBeGreaterThan(detachBox!.y)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(manage).toBeFocused()
  const moduleSelect = page.locator('.repertoire-profile-controls label').filter({ hasText: /^Viewing/ }).locator('select')
  await expect(moduleSelect).toHaveValue(/\d+/)
  const colorToggle = page.getByRole('switch', { name: /module; switch to/i })
  const [toggleBox, selectBox, manageBox] = await Promise.all([colorToggle.boundingBox(), moduleSelect.boundingBox(), manage.boundingBox()])
  expect(toggleBox && selectBox && manageBox).toBeTruthy()
  expect(toggleBox!.x).toBeLessThan(selectBox!.x)
  expect(manageBox!.width).toBeGreaterThan(150)
  expect(manageBox!.y).toBeGreaterThan(selectBox!.y)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})
