import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const demo = (f: string) => new URL(`../../public/demo/${f}`, import.meta.url).pathname;
const file = (f: string, mimeType: string) => ({ name: f, mimeType, buffer: readFileSync(demo(f)) });

async function freshDemo(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('#/');
  await expect(page.getByText('Documents are ready for analysis')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('demo-banner')).toContainText('synthetic data');
  return errors;
}

async function analyze(page: Page) {
  await page.getByTestId('analyze-button').first().click();
  await expect(page.getByTestId('analysis-summary')).toBeVisible({ timeout: 30000 });
}

test('TEST 20: app loads, demo case is seeded and analysis produces evidence-backed findings', async ({ page }) => {
  const errors = await freshDemo(page);
  await analyze(page);
  await expect(page.getByTestId('analysis-summary')).toContainText('Findings produced');
  await page.getByTestId('open-queue').click();
  await expect(page.getByTestId('queue-table').getByTestId('finding-link')).toHaveCount(7);
  expect(errors).toEqual([]);
});

test('TEST 9/7/8: open a finding, inspect evidence, view the highlighted source passage', async ({ page }) => {
  await freshDemo(page);
  await analyze(page);
  await page.goto('#/queue');
  await page.getByRole('link', { name: /Penicillin allergy documented in one record/ }).click();
  await expect(page.getByTestId('finding-title')).toContainText('Penicillin allergy');
  const a = page.getByTestId('evidence-side-A');
  const b = page.getByTestId('evidence-side-B');
  await expect(a.getByTestId('evidence-quote').first()).toHaveText('“Penicillin allergy documented.”');
  await expect(b.getByTestId('evidence-quote').first()).toHaveText('“No known drug allergies.”');
  // Page number shown only for the PDF source; not for DOCX/TXT.
  await expect(a.getByTestId('evidence-location').first()).toContainText('Page 2 (verified PDF page)');
  await expect(b.getByTestId('evidence-location').first()).toContainText('Not a paged format');
  await expect(b.getByTestId('evidence-location').first()).not.toContainText('Page');
  await a.getByTestId('view-in-source').first().click();
  await expect(page.getByTestId('evidence-highlight')).toHaveText('Penicillin allergy documented.');
  await expect(page.getByTestId('doc-text')).toContainText('Page 2 (verified)');
});

test('TEST 10-13: review decision requires a reason, is audited and survives a refresh', async ({ page }) => {
  await freshDemo(page);
  await analyze(page);
  await page.goto('#/queue?q=metformin');
  await page.getByTestId('finding-link').first().click();
  await page.getByRole('button', { name: 'Begin review' }).click();
  await expect(page.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/In review/);
  await page.getByTestId('note-input').fill('Called prescriber to confirm current metformin dose.');
  await page.getByTestId('save-note').click();
  await expect(page.getByTestId('finding-audit')).toContainText('Called prescriber');
  await page.getByRole('button', { name: 'Mark as resolved' }).click();
  await page.getByTestId('confirm-decision').click();
  await expect(page.getByRole('alert').filter({ hasText: 'reason of at least' })).toBeVisible();
  await page.getByTestId('reason-input').fill('Prescriber confirmed 1000 mg twice daily; reconciliation record outdated.');
  await page.getByTestId('confirm-decision').click();
  await expect(page.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/Resolved by reviewer/);
  await page.reload();
  await expect(page.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/Resolved by reviewer/, { timeout: 15000 });
  const audit = page.getByTestId('finding-audit');
  await expect(audit).toContainText('In review → Resolved by reviewer');
  await expect(audit).toContainText('Prescriber confirmed 1000 mg');
  await expect(audit).toContainText('Called prescriber');
  await page.goto('#/timeline');
  await expect(page.getByTestId('timeline-events')).toContainText('Prescriber confirmed 1000 mg');
});

test('TEST 18: search and filters operate on real data', async ({ page }) => {
  await freshDemo(page);
  await analyze(page);
  await page.goto('#/queue');
  const rows = page.getByTestId('queue-table').getByTestId('finding-link');
  await page.getByTestId('queue-search').fill('no known drug allergies');
  await expect(rows).toHaveCount(2);
  await page.getByTestId('queue-search').fill('');
  await page.getByRole('tab', { name: /Historical \/ contextual/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Lisinopril');
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.getByTestId('filter-category').selectOption('lab');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Potassium');
});

test('TEST 14/16/17: upload TXT (new findings), reject unsupported and empty files, flag scanned PDF', async ({ page }) => {
  await freshDemo(page);
  await analyze(page);
  await page.goto('#/documents');
  await page.getByTestId('file-input').setInputFiles([
    file('sample-follow-up-note-2026-03-20.txt', 'text/plain'),
    { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('PNG') },
    { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
    { name: 'scan.pdf', mimeType: 'application/pdf', buffer: readFileSync(demo('sample-scanned-no-text-layer.pdf')) },
  ]);
  await expect(page.getByTestId('staged-date').first()).toHaveValue('2026-03-20');
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-summary')).toBeVisible({ timeout: 30000 });
  const staged = page.getByTestId('staged-list');
  await expect(staged).toContainText('Unsupported file type ".png"');
  await expect(staged).toContainText('empty');
  await expect(staged).toContainText('OCR is not available');
  await expect(page.getByTestId('upload-summary')).toContainText('new');
  // never vs current, never vs former (existing), former vs current
  await page.goto('#/queue?q=smoking');
  await expect(page.getByTestId('queue-table').getByTestId('finding-link')).toHaveCount(3);
});

test('TEST 15: a readable PDF can be uploaded into a new case and analyzed', async ({ page }) => {
  await freshDemo(page);
  await page.goto('#/cases');
  await page.getByTestId('new-case-label').fill('CASE-E2E · PDF test');
  await page.getByTestId('create-case').click();
  await expect(page).toHaveURL(/#\/documents/);
  await page.getByTestId('file-input').setInputFiles([
    file('discharge-summary-2026-03-12.pdf', 'application/pdf'),
    { name: 'intake-2026-03-15.txt', mimeType: 'text/plain', buffer: Buffer.from('Allergies: No known drug allergies.\nMEDICATIONS\nMetformin 850 mg twice daily.') },
  ]);
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-summary')).toContainText('2 documents', { timeout: 30000 });
  await page.goto('#/queue');
  const rows = page.getByTestId('queue-table').getByTestId('finding-link');
  await expect(rows).toHaveCount(2);
  // Case separation: the demo case's intake form is not compared with this case.
  await expect(page.getByTestId('queue-table')).not.toContainText('Smoking');
});
