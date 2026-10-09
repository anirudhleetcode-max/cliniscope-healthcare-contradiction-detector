import { expect, test, type Browser, type Page } from '@playwright/test';

// Two genuinely separate browser contexts (separate storage, separate sessions)
// talk to a real MEDGUARD API server. Skipped when no API server is available
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
  // A deployed API on a free hosting plan may need up to a minute to wake up.
  await expect(page.getByTestId('server-health')).toContainText('Reachable', { timeout: 100_000 });
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
  test.setTimeout(240000);
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
  await expect(alice.getByRole('status').filter({ hasText: 'can now access this case as reviewer' })).toBeVisible();

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

test('a review started while the case is still syncing to a slow server waits for the sync', async ({ browser }) => {
  test.setTimeout(150000);
  const carol = await signUp(browser, 'Carol Reviewer', `carol-${run}@example.test`);
  // Hold every case sync for 6 s, as a free-tier server with a distant database can (seen live: ~11 s).
  await carol.route('**/api/cases/*/snapshot', async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
  await carol.goto('#/cases');
  await carol.getByTestId('new-case').click();
  await carol.getByTestId('new-case-label').fill(`SLOW-${run} · synthetic`);
  await carol.getByTestId('create-shared-case').click();
  await expect(carol).toHaveURL(/#\/documents/);
  await carol.getByTestId('file-input').setInputFiles([
    { name: 'discharge-2026-03-12.txt', mimeType: 'text/plain', buffer: Buffer.from('ALLERGIES\nPenicillin allergy documented.\nMEDICATIONS\nMetformin 500 mg twice daily.') },
    { name: 'intake-2026-03-15.txt', mimeType: 'text/plain', buffer: Buffer.from('Allergies: No known drug allergies.\nMEDICATIONS\nMetformin 1000 mg twice daily.') },
  ]);
  await carol.getByTestId('upload-submit').click();
  // The local analysis is shown before the (held) sync to the server has finished.
  await expect(carol.getByTestId('upload-summary')).toContainText('2 findings', { timeout: 30000 });
  await carol.goto('#/contradictions?case=current&q=penicillin');
  await carol.getByTestId('finding-link').first().click();
  await carol.getByRole('button', { name: 'Begin review' }).click();
  await expect(carol.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/In review/, { timeout: 30000 });
  // The decision is on the server, not only in this tab.
  await carol.reload();
  await expect(carol.getByTestId('finding-detail').getByTestId('status-badge').first()).toHaveText(/In review/, { timeout: 30000 });
  await carol.context().close();
});

test('an outsider cannot open a case they were not invited to; signed-out users cannot act', async ({ browser }) => {
  // First visit: the Overview offers sign-in, registration and the demo.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('#/');
  await expect(visitor.getByTestId('entry-sign-in')).toBeVisible();
  await expect(visitor.getByTestId('entry-register')).toBeVisible();
  await expect(visitor.getByTestId('entry-demo')).toBeVisible();
  await visitor.close();

  const eve = await signUp(browser, 'Eve Outsider', `eve-${run}@example.test`);
  // An owner removes a member: confirmation first, then feedback only after the server confirms.
  const olga = await signUp(browser, 'Olga Owner', `olga-${run}@example.test`);
  await olga.goto('#/cases');
  await olga.getByTestId('new-case').click();
  await olga.getByTestId('new-case-label').fill(`REMOVE-${run} · synthetic`);
  await olga.getByTestId('create-shared-case').click();
  await expect(olga).toHaveURL(/#\/documents/);
  await expect(olga.getByTestId('mode-chip')).toContainText('Shared workspace · owner');
  await olga.goto('#/case');
  await olga.getByTestId('member-email').fill(`eve-${run}@example.test`);
  await olga.getByTestId('add-member').click();
  await expect(olga.getByTestId('member-list')).toContainText('Eve Outsider');
  await olga.getByTestId('remove-member').click();
  await olga.getByRole('button', { name: 'Cancel' }).click();
  await expect(olga.getByTestId('member-list')).toContainText('Eve Outsider');
  await olga.getByTestId('remove-member').click();
  await olga.getByTestId('confirm-remove-member').click();
  await expect(olga.getByRole('status').filter({ hasText: 'no longer has access to this case' })).toBeVisible();
  await expect(olga.getByTestId('member-list')).not.toContainText('Eve Outsider');
  // Signed in with no cases: the server-backed overview shows an empty state, not demo numbers.
  await eve.goto('#/');
  await expect(eve.getByTestId('overview-empty')).toBeVisible({ timeout: 30_000 });
  // Profile edit is saved on the server and shown in the menu.
  await eve.goto('#/settings#workspace');
  await eve.getByTestId('profile-name-input').fill('Eve Renamed');
  await eve.getByTestId('profile-save').click();
  await expect(eve.getByTestId('signed-in-as')).toHaveText('Eve Renamed');
  const tok = await eve.evaluate(() => JSON.parse(sessionStorage.getItem('medguard.session')!).token as string);
  expect((await (await eve.request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${tok}` } })).json()).user.displayName).toBe('Eve Renamed');
  await eve.goto('#/cases');
  await expect(eve.getByTestId('shared-cases')).toContainText('No shared cases yet');
  // Direct API probe with Eve's session for a non-existent/unshared case → 404.
  const token = await eve.evaluate(() => JSON.parse(sessionStorage.getItem('medguard.session')!).token as string);
  const r = await eve.request.get(`${API}/api/cases/case_doesnotexist01`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status()).toBe(404);
  const anon = await eve.request.get(`${API}/api/cases`);
  expect(anon.status()).toBe(401);
  // The header menu shows the authenticated profile (from the API) and signs out through the API.
  await eve.getByRole('button', { name: 'User menu' }).click();
  await expect(eve.getByTestId('profile-name')).toHaveText('Eve Renamed');
  await expect(eve.getByTestId('profile-email')).toHaveText(`eve-${run}@example.test`);
  await eve.getByTestId('menu-sign-out').click();
  await eve.goto('#/settings#workspace');
  await expect(eve.getByTestId('ws-submit')).toBeVisible();
  // The revoked token no longer works.
  expect((await eve.request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
});

test('profile menu: Sign in and Create account open the matching form, even when Settings is already open', async ({ page }) => {
  await page.goto('#/settings');
  await page.getByTestId('server-url').fill(API);
  await page.getByTestId('save-server-url').click();
  await expect(page.getByTestId('server-health')).toContainText('Reachable', { timeout: 100_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByTestId('menu-sign-in').click();
  await expect(page.getByTestId('workspace-panel')).toBeInViewport();
  await expect(page.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('ws-name')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByTestId('menu-register').click();
  await expect(page.getByTestId('workspace-panel')).toBeInViewport();
  await expect(page.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('ws-name').fill('Menu Reviewer');
  await page.getByTestId('ws-email').fill(`menu-${run}@example.test`);
  await page.getByTestId('ws-password').fill(PASSWORD);
  await page.getByTestId('ws-submit').click();
  await expect(page.getByTestId('signed-in-as')).toHaveText('Menu Reviewer');
  // Signed in: the menu offers sign-out instead of the sign-in entries.
  await page.getByRole('button', { name: 'User menu' }).click();
  await expect(page.getByTestId('menu-sign-in')).toHaveCount(0);
  await expect(page.getByTestId('menu-sign-out')).toBeVisible();
});
