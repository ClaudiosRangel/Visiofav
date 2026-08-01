import { test, expect } from '@playwright/test'

test('página raiz carrega sem erro', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Create Next App|VisioFab/i)
})
