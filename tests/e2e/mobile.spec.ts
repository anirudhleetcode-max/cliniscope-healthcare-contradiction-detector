import { expect, test } from '@playwright/test';

test('mobile layout: no horizontal overflow and finding detail is readable', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Documents are ready for analysis')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('analyze-button').first().click();
  await expect(page.getByTestId('analysis-summary')).toBeVisible({ timeout: 30000 });
  await page.goto('./#/queue');
  await page.getByRole('link', { name: /Penicillin allergy/ }).last().click();
  await expect(page.getByTestId('evidence-side-A')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
