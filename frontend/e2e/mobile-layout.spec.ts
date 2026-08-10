import { expect, test } from '@playwright/test'

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
