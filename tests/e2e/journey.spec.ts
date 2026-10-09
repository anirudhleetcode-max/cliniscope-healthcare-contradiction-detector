import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The complete judge journey against the real static app — no backend, no API key.
async function demoReady(page: Page) {
  await page.goto('#/');
  await expect(page.getByText('Documents are ready for analysis').or(page.getByTestId('analysis-summary'))).toBeVisible({ timeout: 90000 });
}

async function download(page: Page, testId: string): Promise<{ name: string; text: string; path: string }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: readFileSync(path!, 'utf8'), path: path! };
}

test('judge journey: demo → evidence → review → export → reload (local mode, no backend)', async ({ page }) => {
  test.setTimeout(150000);
  const external: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('github.io') && !u.hostname.includes('fonts.g')) external.push(u.hostname); });

  // 1-2. Open the app; local mode is active.
  await demoReady(page);
  await expect(page.getByTestId('mode-chip')).toContainText('Local demo mode');
  // 3-4. Load the demonstration case explicitly; the synthetic-data warning is visible.
  await page.goto('#/settings');
  await expect(page.getByTestId('status-mode')).toHaveText('Local demo mode');
  await expect(page.getByTestId('status-persistence')).toContainText('IndexedDB working');
  await expect(page.getByTestId('status-ai')).toContainText('Unavailable');
  await page.getByTestId('load-demo').click();
  await expect(page.getByTestId('demo-banner')).toContainText('synthetic data');
  // 5-6. Document list → inspect a source document.
  await page.goto('#/documents');
  await expect(page.getByTestId('documents-table').locator('tbody tr')).toHaveCount(5);
  await page.getByRole('link', { name: 'Medication Reconciliation Record' }).click();
  await expect(page.getByTestId('doc-text')).toContainText('Date of birth: 4 February 1961');
  // 7. Run contradiction detection.
  await page.goto('#/documents');
  await page.getByTestId('analyze-button').first().click();
  await expect(page.getByText(/Analysis complete/).first()).toBeVisible({ timeout: 30000 });
  // 8-10. Open a potential contradiction; both statements and both source documents are identifiable.
  await page.goto('#/contradictions?case=current&q=date%20of%20birth');
  await page.getByTestId('finding-link').first().click();
  await expect(page.getByTestId('finding-title')).toContainText('Date of birth differs between records');
  const a = page.getByTestId('evidence-side-A');
  const b = page.getByTestId('evidence-side-B');
  await expect(a.getByTestId('evidence-quote')).toHaveText('“Date of birth: 4 February 1961”');
  await expect(a).toContainText('Medication Reconciliation Record');
  await expect(b.getByTestId('evidence-quote').first()).toHaveText('“Date of birth: 14 February 1961”');
  await expect(b).toContainText('Discharge Summary');
  await expect(b).toContainText('Patient Intake Form');
  const findingUrl = page.url();
  // 11-13. Reviewer note, decision, new status.
  await page.getByRole('button', { name: 'Begin review' }).click();
  await page.getByTestId('note-input').fill('Checked synthetic ID card: 14 February 1961; reconciliation record has a typo.');
  await page.getByTestId('save-note').click();
  await expect(page.getByTestId('finding-audit')).toContainText('typo');
  await page.getByRole('button', { name: 'Confirm discrepancy' }).click();
  await page.getByTestId('reason-input').fill('Records disagree; correction requested.');
  await page.getByTestId('confirm-decision').click();
  await expect(page.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/Confirmed discrepancy/);
  // 14-16. Navigate away and back: note and status remain.
  await page.goto('#/documents');
  await page.goto(findingUrl);
  await expect(page.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/Confirmed discrepancy/);
  await expect(page.getByTestId('finding-audit')).toContainText('reconciliation record has a typo');
  await expect(page.getByTestId('finding-audit')).toContainText('In review → Confirmed discrepancy');
  // Filters reflect the decision.
  await page.goto('#/contradictions?case=current&status=confirmed');
  await expect(page.getByTestId('queue-table').getByTestId('finding-link')).toHaveCount(1);
  // 17-18. Export the case report; it contains the finding, decision, note and history.
  await page.goto('#/');
  const report = await download(page, 'export-report');
  expect(report.name).toMatch(/report.*SYNTHETIC\.json$/);
  const json = JSON.parse(report.text);
  expect(json.dataClassification).toMatch(/SYNTHETIC DEMONSTRATION DATA/);
  expect(json.mode.kind).toBe('local-demo-mode');
  const f = json.findings.find((x: any) => /Date of birth/.test(x.title));
  expect(f.reviewStatus).toBe('confirmed');
  expect(f.reviewerNotes[0].note).toContain('typo');
  expect(f.reviewHistory.some((h: any) => h.to === 'confirmed' && h.reason === 'Records disagree; correction requested.')).toBe(true);
  expect(f.evidence.map((e: any) => e.documentTitle)).toContain('Medication Reconciliation Record');
  const csv = await download(page, 'export-csv');
  expect(csv.text).toContain('Confirmed discrepancy');
  // 19-20. Reload: persisted data remains.
  await page.reload();
  await page.goto(findingUrl);
  await expect(page.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/Confirmed discrepancy/, { timeout: 20000 });
  await expect(page.getByTestId('finding-audit')).toContainText('typo');
  expect(external).toEqual([]); // no third-party network calls in the core workflow
});

test('works offline after the app has loaded, including a reload while disconnected', async ({ page, context }) => {
  test.setTimeout(150000);
  await demoReady(page);
  await page.getByTestId('analyze-button').first().click();
  await expect(page.getByTestId('analysis-summary')).toBeVisible({ timeout: 30000 });
  // Wait until the service worker controls the page and has cached the app shell.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => {});
  await page.reload();
  await page.waitForFunction(async () => (await caches.keys()).length > 0 && (await (await caches.open('cliniscope-v1')).keys()).length > 5, null, { timeout: 30000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('metrics')).toBeVisible({ timeout: 30000 });
  await page.goto('#/contradictions?case=current&q=penicillin');
  await page.getByTestId('finding-link').first().click();
  await page.getByRole('button', { name: 'Begin review' }).click();
  await expect(page.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/In review/);
  await page.goto('#/');
  const r = await download(page, 'export-report');
  expect(JSON.parse(r.text).findings.length).toBe(10);
  await context.setOffline(false);
});

test('empty states and "no potential contradictions" wording', async ({ page }) => {
  await demoReady(page);
  await page.goto('#/cases');
  await page.getByTestId('new-case').click();
  await page.getByTestId('new-case-label').fill('EMPTY-CASE');
  await page.getByTestId('create-case').click();
  // Creating a case navigates to its document library; wait for that before navigating on.
  
  await expect(page.getByRole('heading', { level: 1 })).toContainText('EMPTY-CASE');
  await page.goto('#/contradictions?case=current');
  await expect(page.getByText('No findings yet')).toBeVisible();
  await page.goto('#/documents');
  await expect(page.getByText('No documents in this case')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles([{ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('DIAGNOSES\nHypertension.') }]);
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-summary')).toBeVisible({ timeout: 30000 });
  await page.goto('#/contradictions?case=current');
  await expect(page.getByText('No potential contradictions were detected by the available rules.')).toBeVisible();
});

test('reset restores the demo safely and leaves user cases untouched', async ({ page }) => {
  test.setTimeout(150000);
  await demoReady(page);
  await page.getByTestId('analyze-button').first().click();
  await expect(page.getByTestId('analysis-summary')).toBeVisible({ timeout: 30000 });
  await page.goto('#/contradictions?case=current&q=metformin');
  await page.getByTestId('finding-link').first().click();
  await page.getByRole('button', { name: 'Begin review' }).click();
  await page.goto('#/cases');
  await page.getByTestId('new-case').click();
  await page.getByTestId('new-case-label').fill('KEEP-ME');
  await page.getByTestId('create-case').click();
  // Creating a case navigates to its document library; wait for that before navigating on.
  
  await expect(page.getByRole('heading', { level: 1 })).toContainText('KEEP-ME');
  await page.goto('#/settings');
  await page.getByTestId('reset-demo').click();
  await expect(page.getByRole('dialog')).toContainText('only the synthetic demonstration case');
  await page.getByTestId('confirm-reset').click();
  await expect(page.getByText('Documents are ready for analysis')).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId('metrics')).toContainText('analysis not run yet');
  await page.goto('#/cases');
  await expect(page.getByRole('main').getByText('KEEP-ME', { exact: true })).toBeVisible();
});

test('backup → restore round trip creates a new case with review state intact; invalid backups are rejected', async ({ page }) => {
  test.setTimeout(150000);
  await demoReady(page);
  await page.getByTestId('analyze-button').first().click();
  await expect(page.getByTestId('analysis-summary')).toBeVisible({ timeout: 30000 });
  await page.goto('#/contradictions?case=current&q=penicillin');
  await page.getByTestId('finding-link').first().click();
  await page.getByRole('button', { name: 'Begin review' }).click();
  await page.getByRole('button', { name: 'Dismiss — not a contradiction' }).click();
  await page.getByTestId('reason-input').fill('Test dismissal for backup round trip.');
  await page.getByTestId('confirm-decision').click();
  await page.goto('#/');
  const backup = await download(page, 'export-backup');
  await page.goto('#/cases');
  await page.getByTestId('restore-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"something-else"}') });
  await expect(page.getByText(/Restore failed — nothing was changed/)).toBeVisible();
  await page.getByTestId('restore-input').setInputFiles(backup.path);
  await expect(page.getByText(/Backup restored as a new case/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('(restored');
  await page.goto('#/contradictions?case=current&status=dismissed');
  await expect(page.getByTestId('queue-table').getByTestId('finding-link')).toHaveCount(1);
});

test('document search/filter and original download', async ({ page }) => {
  await demoReady(page);
  await page.goto('#/documents');
  await page.getByTestId('doc-search').fill('scanned');
  await expect(page.getByTestId('documents-table').locator('tbody tr')).toHaveCount(1);
  await page.getByTestId('doc-search').fill('');
  await page.getByTestId('doc-search').fill('metformin 1000');
  await expect(page.getByTestId('documents-table').locator('tbody tr')).toHaveCount(1);
  await page.getByTestId('doc-search').fill('');
  await page.getByRole('link', { name: 'Medication Reconciliation Record' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download original file' }).click()]);
  expect(readFileSync((await dl.path())!, 'utf8')).toContain('MEDICATION RECONCILIATION RECORD');
});
