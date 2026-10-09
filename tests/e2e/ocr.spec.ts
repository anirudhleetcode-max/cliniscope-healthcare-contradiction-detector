import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const file = (f: string, mimeType: string) => ({ name: f, mimeType, buffer: readFileSync(new URL(`../../public/demo/${f}`, import.meta.url)) });

test('OCR: scanned and mixed PDFs plus a PNG scan are OCR-read in the browser and analysed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('#/cases');
  await page.getByTestId('new-case-label').fill('CASE-OCR · scanned records');
  await page.getByTestId('create-case').click();
  await expect(page).toHaveURL(/#\/documents/);
  await page.getByTestId('file-input').setInputFiles([
    file('sample-mixed-text-and-scan-2026-03-22.pdf', 'application/pdf'),
    file('scanned-discharge-letter-2025-11-20.png', 'image/png'),
  ]);
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-summary')).toBeVisible({ timeout: 90000 });
  const staged = page.getByTestId('staged-list');
  await expect(staged).toContainText('OCR on page 2');
  await expect(staged).toContainText('read with OCR');
  // Allergy: scan says penicillin allergy; mixed PDF page 2 (OCR) says NKDA → conflict with OCR evidence on both sides.
  await page.goto('#/queue?q=penicillin');
  await page.getByTestId('finding-link').first().click();
  await expect(page.getByTestId('ocr-badge')).toHaveCount(2);
  await expect(page.getByTestId('evidence-side-B').getByTestId('evidence-location')).toContainText('Page 2 (verified PDF page, OCR)');
  // Evidence quality is never "high" for OCR-derived quotes.
  await expect(page.getByTestId('finding-detail')).not.toContainText('High evidence availability');
  // Compare OCR text against the rendered original page.
  await page.getByTestId('evidence-side-B').getByTestId('view-in-source').click();
  await expect(page.getByTestId('evidence-highlight')).toContainText('No known drug allergies');
  await page.getByTestId('compare-original').click();
  await expect(page.getByTestId('original-preview').locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
