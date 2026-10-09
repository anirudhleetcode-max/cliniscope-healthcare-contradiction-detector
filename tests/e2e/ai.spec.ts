import { expect, test } from '@playwright/test';
import { e2eWriteApi } from '../support/targets';

// Exercises the AI-assisted pipeline end to end against a LOCAL FAKE provider
// (tests/e2e/fake-anthropic.mjs). This verifies plumbing and evidence
// validation, not the quality of a real model.
// Creates an account and a case: only against an isolated test server (see tests/support/targets.ts).
const API = e2eWriteApi(process.env.AI_API_URL, process.env.BASE_URL ? '' : 'http://localhost:8789');
test.skip(!API, 'No AI-configured API server for this run');

test('AI-assisted findings require consent, keep only verified quotes, and are labelled', async ({ page }) => {
  test.setTimeout(90000);
  const run = Date.now().toString(36);
  await page.goto('#/settings#workspace');
  await page.getByTestId('server-url').fill(API);
  await page.getByTestId('save-server-url').click();
  await expect(page.getByTestId('ai-status')).toContainText('configured');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByTestId('ws-name').fill('AI Tester');
  await page.getByTestId('ws-email').fill(`ai-${run}@example.test`);
  await page.getByTestId('ws-password').fill('synthetic-pass-123');
  await page.getByTestId('ws-submit').click();
  await expect(page.getByTestId('signed-in-as')).toHaveText('AI Tester');

  await page.goto('#/cases');
  await page.getByTestId('new-case').click();
  await page.getByTestId('new-case-label').fill(`AI-${run}`);
  await page.getByTestId('create-case').click(); // local case: AI still goes through the authenticated server
  await page.getByTestId('file-input').setInputFiles([
    { name: 'note-a-2026-03-12.txt', mimeType: 'text/plain', buffer: Buffer.from('HISTORY\nPatient reports occasional shortness of breath on exertion.') },
    { name: 'note-b-2026-03-20.txt', mimeType: 'text/plain', buffer: Buffer.from('REVIEW OF SYSTEMS\nDenies shortness of breath.') },
  ]);
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-summary')).toBeVisible({ timeout: 30000 });

  await page.goto('#/case');
  await expect(page.getByTestId('ai-availability')).toContainText('available');
  await page.getByTestId('run-ai').click();
  await expect(page.getByRole('dialog')).toContainText('Send case text to the AI provider?');
  await page.getByTestId('confirm-ai').click();
  await expect(page.getByTestId('ai-result')).toContainText('1 new AI-assisted finding', { timeout: 30000 });
  await expect(page.getByTestId('ai-result')).toContainText('1 rejected');

  await page.goto('#/contradictions?case=current&q=shortness');
  await page.getByTestId('finding-link').first().click();
  await expect(page.getByTestId('ai-badge')).toBeVisible();
  await expect(page.getByTestId('finding-detail')).toContainText('AI-generated interpretation');
  await expect(page.getByTestId('evidence-side-A').getByTestId('evidence-quote')).toHaveText('“Patient reports occasional shortness of breath on exertion.”');
  await expect(page.getByTestId('evidence-side-B').getByTestId('evidence-quote')).toHaveText('“Denies shortness of breath.”');
  await expect(page.getByTestId('finding-detail')).not.toContainText('2031'); // model-invented date dropped
  await expect(page.getByTestId('finding-detail')).not.toContainText('Warfarin');
  await expect(page.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/Unreviewed/);
});
