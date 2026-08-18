import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const release = {
  id: 99,
  templateSlug: 'vienna',
  name: 'Vienna Game',
  changelog: '',
  color: 'white',
  version: 1,
  publishedAt: '2026-01-01T00:00:00Z',
  commonStart: '1. e4 e5 2. Nc3',
  lineCount: 99,
  tree: {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': [
      { san: 'e4', uci: 'e2e4', resultingFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -' },
    ],
  },
  lines: [{
    id: 'vienna-1',
    label: 'Main line 1',
    source: 'manual',
    sortOrder: 0,
    steps: [{
      originFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
      san: 'e4',
      uci: 'e2e4',
      resultingFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    }],
  }],
}

async function mockVienna(page: Page) {
  await page.route('**/api/v1/opening-templates/', (route) => route.fulfill({ json: [{
    slug: 'vienna',
    name: 'Vienna Game',
    description: 'Authored Vienna repertoire',
    color: 'white',
    kind: 'community',
    publisherName: 'Kurtis',
    latestRelease: { id: 99, version: 1, publishedAt: release.publishedAt, commonStart: release.commonStart, lineCount: 99 },
  }] }))
  await page.route('**/api/v1/opening-templates/vienna/releases/1/', (route) => route.fulfill({ json: release }))
}

test('signed-out users receive an editable local Vienna module by default and after refresh', async ({ page }) => {
  await mockVienna(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Jump right in' }).click()

  const workspace = page.getByLabel('Opening modules').getByRole('combobox')
  await expect(workspace).toHaveValue(/\d+/)
  await expect(workspace).toContainText('Vienna Game')
  await expect(workspace).not.toContainText('read-only')
  await expect(page.locator('.continuation-move-button', { hasText: 'e4' })).toBeVisible()

  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Opening modules' })
  await expect(dialog).toContainText('Vienna Game')
  await expect(dialog.locator('[data-guide="walkthrough-vienna-module"]')).not.toContainText('Read-only')
  await dialog.getByRole('button', { name: 'Close module manager' }).click()

  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect.poll(async () => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('opening-prep:repertoire') ?? '{}')
    return stored.modules?.some((module: { name?: string }) => module.name === 'Vienna Game')
  })).toBe(true)

  await page.reload()
  await expect(workspace).toHaveValue(/\d+/)
  await expect(workspace).toContainText('Vienna Game')
  await expect(page.locator('.continuation-move-button', { hasText: 'e4' })).toBeVisible()
})

test('desktop walkthrough spotlights do not reflow or scroll away the header', async ({ page }) => {
  await mockVienna(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  const tagline = page.locator('.app-header > p')
  const board = page.locator('[data-guide="board"]')
  const taglineBefore = await tagline.boundingBox()
  const boardBefore = await board.boundingBox()

  await page.getByRole('button', { name: 'Start walkthrough' }).click()
  await expect(tagline).toBeInViewport()
  await expect(page.locator('[data-guide="modes"]')).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

  const next = page.getByRole('button', { name: 'Next' })
  await next.click()
  await next.click()
  await expect(page.locator('[data-guide="brand"]')).toBeInViewport()
  await expect(page.locator('[data-guide="modes"]')).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

  const taglineAfter = await tagline.boundingBox()
  const boardAfter = await board.boundingBox()
  expect(taglineAfter?.height).toBe(taglineBefore?.height)
  expect(boardAfter?.x).toBe(boardBefore?.x)
  expect(boardAfter?.width).toBe(boardBefore?.width)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.locator('.walkthrough-card').getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.locator('[data-guide="board"]')).toBeInViewport()
})
