import { expect, test, type Browser, type Page } from '@playwright/test';

// Two genuinely separate browser contexts (separate storage, separate sessions)
// talk to a real MEDGAURD API server. Skipped when no API server is available
// (e.g. production smoke tests against static GitHub Pages).
const API = process.env.API_URL ?? (process.env.BASE_URL ? '' : 'http://localhost:8787');
test.skip(!API, 'No shared-workspace API server configured for this run');

const run = Date.now().toString(36);
const PASSWORD = 'synthetic-pass-123';

async function signUp(browser: Browser, name: string, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('#/settings#workspace');
  await page.getByTestId('server-url').fill(API);
  await page.getByTestId('save-server-url').click();
  await expect(page.getByTestId('server-health')).toContainText('Reachable');
  await expect(page.getByTestId('ai-status')).toContainText('not configured');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByTestId('ws-name').fill(name);
  await page.getByTestId('ws-email').fill(email);
  await page.getByTestId('ws-password').fill(PASSWORD);
  await page.getByTestId('ws-submit').click();
  await expect(page.getByTestId('signed-in-as')).toHaveText(name);
  return page;
}

test('two authenticated reviewers share a case: decisions and audit history are visible to both', async ({ browser }) => {
  test.setTimeout(120000);
  const bob = await signUp(browser, 'Bob Reviewer', `bob-${run}@example.test`);
  const alice = await signUp(browser, 'Alice Owner', `alice-${run}@example.test`);

  // Alice creates a shared case and uploads two synthetic records.
  await alice.goto('#/cases');
  await alice.getByTestId('new-case').click();
  await alice.getByTestId('new-case-label').fill(`SHARED-${run} · synthetic`);
  await alice.getByTestId('create-shared-case').click();
  await expect(alice).toHaveURL(/#\/documents/);
  await expect(alice.getByTestId('mode-chip')).toContainText('Shared workspace · owner');
  await alice.getByTestId('file-input').setInputFiles([
    { name: 'discharge-2026-03-12.txt', mimeType: 'text/plain', buffer: Buffer.from('ALLERGIES\nPenicillin allergy documented.\nMEDICATIONS\nMetformin 500 mg twice daily.') },
    { name: 'intake-2026-03-15.txt', mimeType: 'text/plain', buffer: Buffer.from('Allergies: No known drug allergies.\nMEDICATIONS\nMetformin 1000 mg twice daily.') },
  ]);
  await alice.getByTestId('upload-submit').click();
  await expect(alice.getByTestId('upload-summary')).toContainText('2 findings', { timeout: 30000 });

  // Alice shares the case with Bob as reviewer.
  await alice.goto('#/case');
  await alice.getByTestId('member-email').fill(`bob-${run}@example.test`);
  await alice.getByTestId('add-member').click();
  await expect(alice.getByTestId('member-list')).toContainText('Bob Reviewer');

  // Alice reviews the allergy conflict: reason required, decision saved on the server.
  await alice.goto('#/contradictions?case=current&q=penicillin');
  await alice.getByTestId('finding-link').first().click();
  await alice.getByRole('button', { name: 'Begin review' }).click();
  await expect(alice.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/In review/);
  await alice.getByTestId('note-input').fill('Phoned the synthetic patient: confirms penicillin hives.');
  await alice.getByTestId('save-note').click();
  await expect(alice.getByTestId('finding-audit')).toContainText('confirms penicillin hives');
  await alice.getByRole('button', { name: 'Mark as resolved' }).click();
  await alice.getByTestId('confirm-decision').click();
  await expect(alice.getByRole('alert').filter({ hasText: 'reason of at least' })).toBeVisible();
  await alice.getByTestId('reason-input').fill('Intake form corrected after verification with patient.');
  await alice.getByTestId('confirm-decision').click();
  await expect(alice.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/Resolved by reviewer/);

  // Bob, in a different browser context, opens the same shared case from the server.
  await bob.goto('#/cases');
  await bob.getByTestId('shared-cases').getByRole('button', { name: 'Open shared case' }).click();
  await expect(bob.getByTestId('mode-chip')).toContainText('Shared workspace · reviewer');
  await bob.goto('#/contradictions?case=current&q=penicillin');
  await bob.getByTestId('finding-link').first().click();
  await expect(bob.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/Resolved by reviewer/);
  const audit = bob.getByTestId('finding-audit');
  await expect(audit).toContainText('In review → Resolved by reviewer');
  await expect(audit).toContainText('Intake form corrected after verification');
  await expect(audit).toContainText('Alice Owner');
  await expect(audit).toContainText('confirms penicillin hives');
  await bob.goto('#/timeline');
  await expect(bob.getByTestId('timeline-events')).toContainText('Collaborator added');

  // Bob reopens with a reason; Alice sees it after refresh (server is the source of truth).
  await bob.goto('#/contradictions?case=current&q=penicillin');
  await bob.getByTestId('finding-link').first().click();
  await bob.getByRole('button', { name: /Mark as unresolved/ }).click();
  await bob.getByTestId('reason-input').fill('New discharge letter received; re-check needed.');
  await bob.getByTestId('confirm-decision').click();
  await expect(bob.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/In review/);
  await alice.reload();
  await expect(alice.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/In review/, { timeout: 20000 });
  await expect(alice.getByTestId('finding-audit')).toContainText('Bob Reviewer');
});

test('an outsider cannot open a case they were not invited to; signed-out users cannot act', async ({ browser }) => {
  const eve = await signUp(browser, 'Eve Outsider', `eve-${run}@example.test`);
  await eve.goto('#/cases');
  await expect(eve.getByTestId('shared-cases')).toContainText('No shared cases yet');
  // Direct API probe with Eve's session for a non-existent/unshared case → 404.
  const token = await eve.evaluate(() => JSON.parse(sessionStorage.getItem('cliniscope.session')!).token as string);
  const r = await eve.request.get(`${API}/api/cases/case_doesnotexist01`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status()).toBe(404);
  const anon = await eve.request.get(`${API}/api/cases`);
  expect(anon.status()).toBe(401);
  await eve.goto('#/settings#workspace');
  await eve.getByTestId('sign-out').click();
  await expect(eve.getByTestId('ws-submit')).toBeVisible();
  // The revoked token no longer works.
  expect((await eve.request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
});
