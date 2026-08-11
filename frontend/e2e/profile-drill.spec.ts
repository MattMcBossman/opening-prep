import { expect, test } from '@playwright/test'

const ROOT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -'
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -'
const AFTER_NC3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq -'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/session/', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: false, user: null }),
  }))
})

test('anonymous profile and module management survives a refresh', async ({ page }) => {
  await page.goto('/')
  const profileSelect = page.locator('.repertoire-profile-controls select').first()
  const editingSelect = page.locator('.repertoire-profile-controls select').nth(1)
  await page.getByRole('button', { name: 'Manage' }).click()

  await page.getByLabel('New profile').fill('Tournament')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(profileSelect).toHaveValue('4')

  await page.getByLabel('New white opening module').fill('Vienna')
  await page.getByRole('button', { name: 'Create module' }).click()
  await expect(editingSelect).toHaveValue('5')
  await expect(editingSelect.getByRole('option', { name: 'Vienna' })).toHaveCount(1)

  await page.reload()
  await expect(profileSelect).toHaveValue('4')
  await expect(editingSelect).toHaveValue('5')
})

test('a selected explorer position launches only eligible saved drill steps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(({ root, afterE4, afterE4E5, afterNc3 }) => {
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
          [root]: [{ san: 'e4', uci: 'e2e4', resultingFen: afterE4 }],
          [afterE4]: [{ san: 'e5', uci: 'e7e5', resultingFen: afterE4E5 }],
          [afterE4E5]: [{ san: 'Nc3', uci: 'b1c3', resultingFen: afterNc3 }],
        } },
        { id: 3, name: 'General Black', color: 'black', tree: {} },
      ],
    }))
  }, { root: ROOT, afterE4: AFTER_E4, afterE4E5: AFTER_E4_E5, afterNc3: AFTER_NC3 })

  await page.goto('/')
  await page.getByRole('tab', { name: 'Moves', exact: true }).click()
  await page.locator('.move-list').evaluate((element) => {
    element.style.height = '44px'
    element.style.maxHeight = '44px'
    element.style.flex = 'none'
  })
  await page.getByRole('button', { name: 'e4', exact: true }).click()
  await expect.poll(() => page.locator('.move-list').evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'e5', exact: true }).click()
  await page.getByRole('button', { name: 'Drill from here' }).click()

  await expect(page.getByRole('group', { name: 'Drill from selected position' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Start at this position' })).toBeChecked()
  await expect(page.getByText('Drill 1 of 1')).toBeVisible()
  const wrongFrom = await page.locator('[data-square="g1"]').boundingBox()
  const wrongTo = await page.locator('[data-square="f3"]').boundingBox()
  expect(wrongFrom && wrongTo).toBeTruthy()
  await page.mouse.move(wrongFrom!.x + wrongFrom!.width / 2, wrongFrom!.y + wrongFrom!.height / 2)
  await page.mouse.down()
  await page.mouse.move(wrongTo!.x + wrongTo!.width / 2, wrongTo!.y + wrongTo!.height / 2, { steps: 5 })
  await page.mouse.up()
  const wrongMoveLandedAt = Date.now()
  await expect(page.locator('[data-square="f3"] [data-piece="wN"]')).toBeVisible()
  await expect(page.locator('[data-square="g1"] [data-piece="wN"]')).toHaveCount(0)
  await expect(page.locator('.board-wrapper [style*="239, 92, 92"]')).toHaveCount(2)
  await expect(page.locator('[data-square="g1"] [data-piece="wN"]')).toBeVisible({ timeout: 1_500 })
  expect(Date.now() - wrongMoveLandedAt).toBeGreaterThanOrEqual(850)
  await expect(page.locator('[data-square="f3"] [data-piece="wN"]')).toHaveCount(0)
  const correctFrom = await page.locator('[data-square="b1"]').boundingBox()
  const correctTo = await page.locator('[data-square="c3"]').boundingBox()
  expect(correctFrom && correctTo).toBeTruthy()
  await page.mouse.move(correctFrom!.x + correctFrom!.width / 2, correctFrom!.y + correctFrom!.height / 2)
  await page.mouse.down()
  await page.mouse.move(correctTo!.x + correctTo!.width / 2, correctTo!.y + correctTo!.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeInViewport()
})

test('signed-in explorer saving persists an explicit line across refresh', async ({ page }) => {
  let whiteTree: Record<string, unknown[]> = {}
  let savedPayload: { steps: Array<{ originFen: string; uci: string; resultingFen: string }> } | null = null
  const whiteModule = { id: 11, name: 'General White', description: '', color: 'white', moveCount: 0, createdAt: '', updatedAt: '' }
  const blackModule = { id: 12, name: 'General Black', description: '', color: 'black', moveCount: 0, createdAt: '', updatedAt: '' }
  const profile = {
    id: 21, name: 'Default', description: '', createdAt: '', updatedAt: '', templateReleases: [],
    modules: [
      { ...whiteModule, lineCount: 0, sortOrder: 0, enabled: true },
      { ...blackModule, lineCount: 0, sortOrder: 1, enabled: true },
    ],
  }

  await page.unroute('**/api/v1/auth/session/')
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/v1/auth/session/') return json({ authenticated: true, user: { id: 7, username: 'alice', lichessUsername: 'alice' } })
    if (path === '/api/v1/repertoires/' && request.method() === 'GET') return json([whiteModule, blackModule])
    if (path === '/api/v1/repertoires/profiles/') return json([profile])
    if (path === '/api/v1/repertoires/11/tree/') return json(whiteTree)
    if (path === '/api/v1/repertoires/12/tree/') return json({})
    if (path === '/api/v1/repertoires/11/lines/' && request.method() === 'GET') return json([])
    if (path === '/api/v1/repertoires/12/lines/') return json([])
    if (path === '/api/v1/repertoires/11/lines/' && request.method() === 'POST') {
      savedPayload = request.postDataJSON()
      whiteTree = Object.fromEntries(savedPayload!.steps.map((step) => [step.originFen.split(' ').slice(0, 4).join(' '), [{
        san: 'e4', uci: step.uci, resultingFen: step.resultingFen,
      }]]))
      return json([{ id: 'line-1', lineKey: 'e2e4', uciPath: 'e2e4', label: '', annotations: [], source: 'manual', sortOrder: 0, steps: savedPayload!.steps }])
    }
    if (path === '/api/v1/explorer/stats/') return json({
      totalGames: 10,
      opening: null,
      moves: [{ san: 'e4', uci: 'e2e4', white: 5, draws: 2, black: 3, totalGames: 10 }],
    })
    return json({ detail: `Unhandled test route ${request.method()} ${path}` }, 404)
  })

  await page.goto('/')
  await page.getByRole('row', { name: /e4/ }).click()
  await page.getByRole('button', { name: 'Save to repertoire' }).click()

  await expect.poll(() => savedPayload?.steps[0]?.uci).toBe('e2e4')
  expect(savedPayload!.steps[0].originFen).toBe(`${ROOT} 0 1`)
  expect(savedPayload!.steps[0].resultingFen).toBe(AFTER_E4)
  await expect(page.getByRole('button', { name: 'Remove from repertoire' })).toBeVisible()
  await expect(page.getByText(/Repertoire (change failed|could not be loaded)/)).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Remove from repertoire' })).toBeVisible()
})

test('switching to My games clears public stats and replaces partial snapshots while polling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  let personalRequests = 0
  let personalSpeeds: string | null = null
  const personalRequestsBySpeed = new Map<string, number>()
  const module = (id: number, color: 'white' | 'black') => ({ id, name: `General ${color}`, description: '', color, moveCount: 0, createdAt: '', updatedAt: '' })
  const white = module(31, 'white')
  const black = module(32, 'black')
  const profile = {
    id: 41, name: 'Default', description: '', createdAt: '', updatedAt: '', templateReleases: [],
    modules: [
      { ...white, lineCount: 0, sortOrder: 0, enabled: true },
      { ...black, lineCount: 0, sortOrder: 1, enabled: true },
    ],
  }
  await page.unroute('**/api/v1/auth/session/')
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/v1/auth/session/') return json({ authenticated: true, user: { id: 8, username: 'bob', lichessUsername: 'bob' } })
    if (path === '/api/v1/repertoires/') return json([white, black])
    if (path === '/api/v1/repertoires/profiles/') return json([profile])
    if (path.endsWith('/tree/')) return json({})
    if (path.endsWith('/lines/')) return json([])
    if (path === '/api/v1/explorer/stats/') return json({
      totalGames: 20, opening: null,
      moves: [{ san: 'c4', uci: 'c2c4', white: 10, draws: 5, black: 5, totalGames: 20 }],
    })
    if (path === '/api/v1/explorer/my-games/') {
      personalSpeeds = new URL(request.url()).searchParams.get('speeds')
      personalRequests += 1
      const speedKey = personalSpeeds ?? 'all'
      const speedRequest = (personalRequestsBySpeed.get(speedKey) ?? 0) + 1
      personalRequestsBySpeed.set(speedKey, speedRequest)
      if (speedRequest === 1) await new Promise((resolve) => setTimeout(resolve, 300))
      const games = speedRequest === 1 ? 5 : 6
      return json({
        totalGames: games, opening: null, stillIndexing: true, queuePosition: 2,
        moves: [{ san: 'e4', uci: 'e2e4', white: games, draws: 0, black: 0, totalGames: games }],
      })
    }
    return route.fulfill({ status: 404 })
  })

  await page.goto('/')
  const publicMoveRow = page.getByRole('row', { name: /c4/ })
  await expect(publicMoveRow).toBeVisible()
  const publicCells = publicMoveRow.getByRole('cell')
  const publicCellBoxes = await Promise.all([0, 1, 2].map((index) => publicCells.nth(index).boundingBox()))
  expect(publicCellBoxes.every(Boolean)).toBe(true)
  expect(Math.max(...publicCellBoxes.map((box) => box!.y)) - Math.min(...publicCellBoxes.map((box) => box!.y))).toBeLessThan(5)
  const sourceToggleBox = await page.getByRole('tablist', { name: 'Explorer data source' }).boundingBox()
  const filtersBox = await page.locator('.explorer-filters-disclosure').boundingBox()
  expect(sourceToggleBox && filtersBox).toBeTruthy()
  expect(Math.abs(sourceToggleBox!.y - filtersBox!.y)).toBeLessThan(8)
  expect(Math.abs(sourceToggleBox!.height - filtersBox!.height)).toBeLessThanOrEqual(1)
  await expect(page.getByLabel('From month')).toBeHidden()
  await page.getByText('Filters', { exact: true }).click()
  await page.getByLabel('From month').selectOption('02')
  await page.getByLabel('From year').selectOption('2024')
  await page.getByRole('checkbox', { name: 'Rapid', exact: true }).check()
  await expect(page.getByText('2 active')).toBeVisible()
  await page.getByText('Filters', { exact: true }).click()
  const activeBadgeFits = await page.getByText('2 active').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(activeBadgeFits.scrollWidth).toBeLessThanOrEqual(activeBadgeFits.clientWidth)
  expect(activeBadgeFits.scrollHeight).toBeLessThanOrEqual(activeBadgeFits.clientHeight)
  await page.getByText('Filters', { exact: true }).click()
  await page.getByRole('tab', { name: 'My games' }).click()
  await expect(page.getByRole('row', { name: /c4/ })).toHaveCount(0)
  await expect(page.getByText('Loading explorer stats…')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Rapid', exact: true })).not.toBeChecked()
  await expect(page.getByLabel('From month')).toHaveValue('')
  await expect(page.getByLabel('From year')).toHaveValue('')
  await page.getByLabel('From month').selectOption('09')
  await page.getByLabel('From year').selectOption('2023')
  await page.getByRole('checkbox', { name: 'Bullet', exact: true }).check()

  await expect(page.getByRole('row', { name: /e4 5/ })).toBeVisible()
  expect(personalSpeeds).toBe('bullet,ultraBullet')
  await expect(page.getByRole('row', { name: /e4 6/ })).toBeVisible({ timeout: 7_000 })
  await expect.poll(() => personalRequests, { timeout: 7_000 }).toBeGreaterThanOrEqual(3)
  await expect(page.getByText('Found 6 games.')).toBeVisible()
  await expect(page.getByText(/checking Lichess for updates/)).toHaveCount(0)

  await page.getByRole('tab', { name: /Lichess (database|DB)/ }).click()
  await expect(page.getByLabel('From month')).toHaveValue('02')
  await expect(page.getByLabel('From year')).toHaveValue('2024')
  await expect(page.getByRole('checkbox', { name: 'Rapid', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Bullet', exact: true })).not.toBeChecked()
  await page.getByRole('tab', { name: 'My games' }).click()
  await expect(page.getByLabel('From month')).toHaveValue('09')
  await expect(page.getByLabel('From year')).toHaveValue('2023')
  await expect(page.getByRole('checkbox', { name: 'Bullet', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Rapid', exact: true })).not.toBeChecked()
})
