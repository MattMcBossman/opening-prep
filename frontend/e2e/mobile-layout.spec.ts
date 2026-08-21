import { expect, test } from '@playwright/test'

test('coverage analysis stays unloaded until requested', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Prep', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Recommended tree' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recommend moves' })).toBeVisible()
  await expect(page.locator('.coverage-dashboard')).toHaveCount(0)
  await page.getByRole('button', { name: 'Analyze coverage' }).click()
  await expect(page.locator('.coverage-dashboard')).toBeVisible()
  await page.getByRole('button', { name: 'Hide coverage' }).click()
  await expect(page.locator('.coverage-dashboard')).toHaveCount(0)
})

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 667, height: 375 },
]

for (const viewport of VIEWPORTS) {
  test(`mobile shell fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)

    const board = await page.locator('.board-wrapper').boundingBox()
    expect(board).not.toBeNull()
    expect(Math.abs((board?.width ?? 0) - (board?.height ?? 0))).toBeLessThanOrEqual(1)
    expect(board?.width ?? 0).toBeGreaterThanOrEqual(viewport.width - 45)
  })
}

test('mobile Explorer sections show one workspace at a time and preserve selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect(page.locator('#mobile-stats-panel')).toBeVisible()
  await expect(page.locator('#mobile-moves-panel')).toBeHidden()

  await page.getByRole('tab', { name: 'Moves', exact: true }).click()
  await expect(page.locator('#mobile-moves-panel')).toBeVisible()
  await expect(page.locator('#mobile-stats-panel')).toBeHidden()

  await page.getByRole('tab', { name: 'Prep', exact: true }).click()
  await expect(page.locator('#mobile-prep-panel')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Prep', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('walkthrough activates and scrolls mobile sections into view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/v1/opening-templates/', (route) => route.fulfill({ json: [{
    slug: 'vienna', name: 'Vienna Game', description: '', color: 'white', kind: 'community', publisherName: 'Kurtis',
    latestRelease: { id: 99, version: 1, publishedAt: '2026-01-01T00:00:00Z', commonStart: '1. e4 e5 2. Nc3', lineCount: 99 },
  }] }))
  await page.route('**/api/v1/opening-templates/vienna/releases/1/', (route) => route.fulfill({ json: {
    id: 99, templateSlug: 'vienna', name: 'Vienna Game', changelog: '', color: 'white', version: 1,
    publishedAt: '2026-01-01T00:00:00Z', commonStart: '1. e4 e5 2. Nc3', lineCount: 99, tree: {}, lines: [],
  } }))
  await page.addInitScript(() => {
    sessionStorage.setItem('opening-prep:explorer-session:v1', JSON.stringify({
      baseFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: [{ san: 'd4', uci: 'd2d4', fenAfter: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1' }],
      pointer: 1,
    }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start walkthrough' }).click()
  await expect(page.locator('.opening-name')).toContainText('Open Game')

  const next = page.getByRole('button', { name: 'Next' })
  await next.click()
  await next.click()
  await expect(page.locator('#mobile-moves-panel')).toBeInViewport()
  await expect(page.locator('#mobile-moves-panel > h2')).toBeInViewport()
  await expect(page.locator('.walkthrough-card')).toHaveCSS('top', '8px')
  await expect(page.getByText('Saved continuations')).toBeVisible()
  await expect(page.getByRole('button', { name: 'e4', exact: true })).toBeVisible()
  await expect(page.locator('.continuation-disclosure[aria-expanded="true"]')).toHaveCount(4)
  await expect(page.locator('.continuation-disclosure[aria-expanded="false"]')).toHaveCount(0)

  for (const move of ['Nc3', 'Nf6', 'f4']) {
    await page.locator('.continuation-move-button', { hasText: move }).first().click()
  }
  await expect(page.locator('.opening-name')).toContainText('Vienna Gambit')
  await expect(page.locator('.continuation-move-button', { hasText: 'd5' })).toBeVisible()

  await next.click()
  await expect(page.locator('.walkthrough-card')).toHaveCSS('top', '8px')
  await expect(page.locator('#mobile-stats-panel')).toContainText('d5')
  await expect(page.locator('#mobile-stats-panel .explorer-row-saved')).toContainText('d5')

  await next.click()
  await expect(page.locator('.walkthrough-card')).toHaveCSS('top', '8px')
  await expect(page.getByRole('tab', { name: 'My games', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.walkthrough-card')).toContainText('Link a Lichess or Chess.com account to review your own game history.')
  await expect(page.locator('#mobile-stats-panel')).toContainText(/Found \d+ games/)

  await next.click()
  await expect(page.locator('.walkthrough-card')).toHaveCSS('top', '8px')

  const coveragePanel = page.locator('[data-guide="coverage"]')
  await expect(page.getByRole('tab', { name: 'Prep', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(async () => coveragePanel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.top >= 0 && rect.bottom <= window.innerHeight
  })).toBe(true)

  await next.click()
  await expect(page.locator('.walkthrough-card')).toHaveCSS('top', '8px')
  const recommendationPanel = page.locator('[data-guide="opening-generator"]')
  await expect.poll(async () => recommendationPanel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.top >= 0 && rect.bottom <= window.innerHeight
  })).toBe(true)
  await expect(page.locator('.walkthrough-card')).toContainText('Experimental tree recommendations')

  await next.click()
  await expect(page.getByRole('tab', { name: 'Drills', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Explorer', exact: true })).toHaveAttribute('aria-selected', 'true')
  await next.click()

  await next.click()
  await next.click()
  const moduleDialog = page.getByRole('dialog', { name: 'Opening modules' })
  await expect(moduleDialog).toBeVisible()
  await expect(page.locator('[data-guide="walkthrough-vienna-module"]')).toBeInViewport()
  await expect(page.locator('.walkthrough-card')).toContainText('The Vienna Game opening module is loaded by default')
  await next.click()
  await page.getByRole('button', { name: 'Browse openings' }).click()
  await expect(page.getByRole('dialog', { name: 'Opening modules' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Module library' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Global opening library' })).toBeVisible()
  await expect.poll(async () => JSON.parse(await page.evaluate(() => sessionStorage.getItem('opening-prep:explorer-session:v1') ?? '{}')).moves?.[0]?.uci).toBe('d2d4')
})

test('mobile board owns touch drags and places the eval bar on the left', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const board = page.locator('.board-wrapper')
  const evalBar = page.locator('.eval-bar')
  await expect(board).toHaveCSS('touch-action', 'none')
  const [boardBox, evalBox] = await Promise.all([board.boundingBox(), evalBar.boundingBox()])
  expect(boardBox).not.toBeNull()
  expect(evalBox).not.toBeNull()
  expect(evalBox!.x).toBeLessThan(boardBox!.x)
})

test('a long opening name does not move the mobile board', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')

  const board = page.locator('.board-wrapper')
  const before = await board.boundingBox()
  await page.locator('.opening-name').evaluate((element) => {
    element.innerHTML = '<span class="opening-name-text">Sicilian Defense, Najdorf Variation, Poisoned Pawn Variation, Main Line</span>'
  })
  const after = await board.boundingBox()

  expect(before).not.toBeNull()
  expect(after).not.toBeNull()
  expect(after!.y).toBe(before!.y)
})

test('mobile hamburger menu combines repertoire and app settings', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')

  const title = page.getByRole('heading', { name: 'Mainline' })
  const mode = page.getByRole('tablist', { name: 'App mode' })
  const menu = page.getByRole('button', { name: 'Open menu' })
  await expect(menu).toBeVisible()
  const [titleBox, modeBox, menuBox] = await Promise.all([
    title.boundingBox(), mode.boundingBox(), menu.boundingBox(),
  ])
  expect(titleBox && modeBox && menuBox).toBeTruthy()
  expect(Math.abs(titleBox!.y - modeBox!.y)).toBeLessThan(12)
  expect(Math.abs(modeBox!.y - menuBox!.y)).toBeLessThan(12)
  await expect(title).toHaveCSS('text-align', 'center')
  await expect(title).toHaveCSS('padding-left', '8px')
  await expect(page.locator('#header-settings')).toBeHidden()
  await menu.click()
  await expect(page.locator('#header-settings')).toBeVisible()
  await expect(page.locator('#header-settings').getByRole('switch', { name: /White repertoire/ })).toBeVisible()
  await expect(page.locator('#header-settings').getByRole('button', { name: 'Manage' })).toBeVisible()
  await expect(page.locator('#header-settings').getByRole('combobox', { name: 'Profile', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: /sound/i })).toBeVisible()
  await expect(page.getByRole('switch', { name: /Light|Dark/ })).toBeVisible()
  await expect(page.locator('#header-settings .header-toggle-label').filter({ hasText: /Sound|Muted/ })).toBeVisible()
  await expect(page.locator('#header-settings .header-toggle-label').filter({ hasText: /Light|Dark/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  const menuCoversBoardArrows = await page.evaluate(() => {
    const menuElement = document.querySelector<HTMLElement>('#header-settings')
    const boardElement = document.querySelector<HTMLElement>('.board-wrapper')
    if (!menuElement || !boardElement) return false
    const menuRect = menuElement.getBoundingClientRect()
    const boardRect = boardElement.getBoundingClientRect()
    const left = Math.max(menuRect.left, boardRect.left)
    const right = Math.min(menuRect.right, boardRect.right)
    const top = Math.max(menuRect.top, boardRect.top)
    const bottom = Math.min(menuRect.bottom, boardRect.bottom)
    if (left >= right || top >= bottom) return false
    const stack = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2)
    const menuIndex = stack.findIndex((element) => element === menuElement || menuElement.contains(element))
    const boardIndex = stack.findIndex((element) => element === boardElement || boardElement.contains(element))
    return menuIndex >= 0 && boardIndex >= 0 && menuIndex < boardIndex
  })
  expect(menuCoversBoardArrows).toBe(true)
  await page.getByRole('button', { name: 'Close menu' }).click()
  await expect(page.locator('#header-settings')).toBeHidden()
})

test('drills keep the module toggle only in the mobile header menu', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Drills' }).click()

  await expect(page.locator('.drill-layout .board-heading .board-color-toggle')).toBeHidden()
  await expect(page.locator('.drill-workspace').getByRole('group', { name: 'Drill starting point' })).toBeVisible()
  await page.getByRole('button', { name: 'Open menu' }).click()
  const repertoireToggle = page.locator('#header-settings').getByRole('switch', { name: /White module/ })
  await expect(repertoireToggle).toBeVisible()
  const moduleValue = repertoireToggle.locator('.board-color-toggle-value')
  await expect(moduleValue).toHaveText('White')
  expect(await moduleValue.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)
})

test('mobile primary controls meet the touch target baseline', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')

  for (const control of ['Back', 'Forward', 'Reset', 'Drill from here']) {
    const box = await page.getByRole('button', { name: new RegExp(control, 'i') }).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }
  const tabs = page.getByRole('tablist', { name: 'Explorer sections' }).getByRole('tab')
  for (let index = 0; index < await tabs.count(); index += 1) {
    const box = await tabs.nth(index).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }
})

test('reduced motion keeps navigation usable and removes long transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Moves', exact: true }).click()
  await expect(page.locator('#mobile-moves-panel')).toBeVisible()
  const duration = await page.locator('.board-controls button').first().evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  )
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001)
})

test('selected-position drill survives a mobile Explorer round trip', async ({ page }) => {
  const root = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
  const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -'
  const afterE4E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -'
  const afterNc3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq -'
  await page.addInitScript((positions) => {
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
        { id: 2, name: 'Vienna', color: 'white', tree: {
          [positions.root]: [{ san: 'e4', uci: 'e2e4', resultingFen: positions.afterE4 }],
          [positions.afterE4]: [{ san: 'e5', uci: 'e7e5', resultingFen: positions.afterE4E5 }],
          [positions.afterE4E5]: [{ san: 'Nc3', uci: 'b1c3', resultingFen: positions.afterNc3 }],
        } },
        { id: 3, name: 'General Black', color: 'black', tree: {} },
      ],
    }))
  }, { root, afterE4, afterE4E5, afterNc3 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Moves', exact: true }).click()
  await expect(page.getByText('Saved continuations')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse e4' }).click()
  await expect(page.getByRole('button', { name: 'Nc3', exact: true })).toBeHidden()
  await expect(page.getByText('1 line', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Expand e4' }).click()
  await expect(page.getByRole('button', { name: 'Nc3', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'e4', exact: true }).click()
  await page.getByRole('button', { name: 'e5', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Moves', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-square="e5"] [data-piece="bP"]')).toBeVisible()
  await page.getByRole('button', { name: 'Drill from here' }).click()
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('radio', { name: 'Start at selected position' })).toBeChecked()
  await page.getByRole('button', { name: 'Close menu' }).click()
  await expect(page.getByText(/Selected position, 1\.\.\.e5/)).toBeVisible()

  await page.getByRole('tab', { name: 'Explorer', exact: true }).click()
  await expect(page.getByTestId('drill-chessboard')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Drills', exact: true }).click()
  await expect(page.getByTestId('drill-chessboard')).toBeVisible()
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('radio', { name: 'Start at selected position' })).toBeChecked()
  await page.getByRole('button', { name: 'Close menu' }).click()
  await expect(page.getByText('Drill 1 of 1')).toBeVisible()

  await page.getByRole('tab', { name: 'Explorer', exact: true }).click()
  await page.getByRole('tab', { name: 'Moves', exact: true }).click()
  await page.getByRole('button', { name: 'Nc3', exact: true }).click()
  await page.getByRole('button', { name: 'Drill from here' }).click()
  await expect(page.getByText(/No saved white lines continue/)).toBeVisible()
  await page.getByRole('button', { name: 'Drill from initial position' }).click()
  await expect(page.getByText('Drill 1 of 1')).toBeVisible()
})

test('enabling Reset after the first mobile move does not leave it highlighted', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const source = await page.locator('[data-square="e2"]').boundingBox()
  const target = await page.locator('[data-square="e4"]').boundingBox()
  expect(source && target).toBeTruthy()
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2)
  await page.mouse.down()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 5 })
  await page.mouse.up()

  const reset = page.getByRole('button', { name: 'Reset', exact: true })
  await expect(reset).toBeEnabled()
  // react-chessboard renders custom square styles on an overlay inside each
  // data-square node, rather than changing the base square's computed color.
  await expect(page.locator('.board-wrapper [style*="255, 235, 59"]')).toHaveCount(2)
  const colors = await reset.evaluate((element) => {
    const button = getComputedStyle(element)
    const surfaceProbe = document.createElement('div')
    surfaceProbe.style.background = 'var(--surface)'
    document.body.append(surfaceProbe)
    const surface = getComputedStyle(surfaceProbe).backgroundColor
    surfaceProbe.remove()
    return { button: button.backgroundColor, surface }
  })
  expect(colors.button).toBe(colors.surface)
})
