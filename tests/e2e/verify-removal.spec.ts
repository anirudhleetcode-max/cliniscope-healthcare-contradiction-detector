// TEMPORARY production verification (not for merge). Synthetic @example.test users only.
import { expect, test, type Browser, type Page } from '@playwright/test';

const API = process.env.API_URL!;
const run = `vr${Date.now().toString(36)}`;
const PASSWORD = 'synthetic-pass-123';

async function signUp(browser: Browser, name: string, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('#/settings#workspace');
  await page.getByTestId('server-url').fill(API);
  await page.getByTestId('save-server-url').click();
  await expect(page.getByTestId('server-health')).toContainText('Reachable', { timeout: 100_000 });
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByTestId('ws-name').fill(name);
  await page.getByTestId('ws-email').fill(email);
  await page.getByTestId('ws-password').fill(PASSWORD);
  await page.getByTestId('ws-submit').click();
  await expect(page.getByTestId('signed-in-as')).toHaveText(name);
  return page;
}
const tokenOf = (p: Page) => p.evaluate(() => JSON.parse(sessionStorage.getItem('medguard.session')!).token as string);

test('failed removal shows an error and keeps the member; removed member loses access; removal is audited', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await signUp(browser, 'Vera Owner', `vera-${run}@example.test`);
  const member = await signUp(browser, 'Milo Member', `milo-${run}@example.test`);
  const label = `VERIFY-${run} · synthetic`;
  await owner.goto('#/cases');
  await owner.getByTestId('new-case').click();
  await owner.getByTestId('new-case-label').fill(label);
  await owner.getByTestId('create-shared-case').click();
  await expect(owner.getByTestId('mode-chip')).toContainText('Shared workspace · owner');
  await owner.goto('#/case');
  await owner.getByTestId('member-email').fill(`milo-${run}@example.test`);
  await owner.getByTestId('add-member').click();
  await expect(owner.getByTestId('member-list')).toContainText('Milo Member');

  const ownerToken = await tokenOf(owner);
  const memberToken = await tokenOf(member);
  const cases = await (await owner.request.get(`${API}/api/cases`, { headers: { Authorization: `Bearer ${ownerToken}` } })).json();
  const caseId = cases.cases.find((c: { label: string }) => c.label === label).id as string;
  const before = await member.request.get(`${API}/api/cases/${caseId}`, { headers: { Authorization: `Bearer ${memberToken}` } });
  console.log(`EVIDENCE member GET case before removal: ${before.status()}`);
  expect(before.status()).toBe(200);

  // TASK 1: the server rejects the removal (simulated in this browser only; nothing is sent).
  await owner.route('**/api/cases/*/members/*', (route) => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error.', code: 'internal' }) })
    : route.continue());
  await owner.getByTestId('remove-member').click();
  await owner.getByTestId('confirm-remove-member').click();
  await expect(owner.getByRole('alert').filter({ hasText: 'Internal server error.' })).toBeVisible();
  await expect(owner.getByRole('status').filter({ hasText: 'no longer has access' })).toHaveCount(0);
  await expect(owner.getByTestId('member-list')).toContainText('Milo Member');
  const still = await member.request.get(`${API}/api/cases/${caseId}`, { headers: { Authorization: `Bearer ${memberToken}` } });
  console.log(`EVIDENCE member GET case after rejected removal: ${still.status()}`);
  expect(still.status()).toBe(200);
  console.log('EVIDENCE task1: error shown, no success message, member still listed and still has access');

  // Recovery: retry with the real server.
  await owner.unroute('**/api/cases/*/members/*');
  if (await owner.getByTestId('confirm-remove-member').isVisible()) await owner.getByRole('button', { name: 'Cancel' }).click();
  await owner.getByTestId('remove-member').click();
  await owner.getByTestId('confirm-remove-member').click();
  await expect(owner.getByRole('status').filter({ hasText: 'no longer has access to this case' })).toBeVisible();
  await expect(owner.getByTestId('member-list')).not.toContainText('Milo Member');
  console.log('EVIDENCE task1 retry: real removal succeeded with success feedback');

  // TASK 2: the removed member's existing session is denied at once, and again on reuse and after reload.
  const after = await member.request.get(`${API}/api/cases/${caseId}`, { headers: { Authorization: `Bearer ${memberToken}` } });
  console.log(`EVIDENCE removed member GET case: ${after.status()}`);
  expect(after.status()).toBe(404);
  await member.reload();
  const again = await member.request.get(`${API}/api/cases/${caseId}`, { headers: { Authorization: `Bearer ${memberToken}` } });
  const activity = await member.request.get(`${API}/api/cases/${caseId}/activity`, { headers: { Authorization: `Bearer ${memberToken}` } });
  const list = await (await member.request.get(`${API}/api/cases`, { headers: { Authorization: `Bearer ${memberToken}` } })).json();
  console.log(`EVIDENCE removed member reuse: case ${again.status()}, activity ${activity.status()}, listed=${list.cases.some((c: { id: string }) => c.id === caseId)}`);
  expect(again.status()).toBe(404);
  expect(activity.status()).toBe(404);
  expect(list.cases.some((c: { id: string }) => c.id === caseId)).toBe(false);
  expect((await member.request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${memberToken}` } })).status()).toBe(200); // still signed in, just no access

  // TASK 3: the owner's activity log has the removal.
  const log = await owner.request.get(`${API}/api/cases/${caseId}/activity`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(log.status()).toBe(200);
  const events = (await log.json()).events as Record<string, unknown>[];
  const removed = events.filter((e) => e.kind === 'member_removed');
  console.log(`EVIDENCE activity: ${events.length} events, member_removed=${removed.length}, detail="${removed[0]?.detail}", caseId match=${removed[0]?.caseId === caseId}, keys=${Object.keys(removed[0] ?? {}).join(',')}`);
  expect(removed).toHaveLength(1);
  expect(removed[0].caseId).toBe(caseId);
  expect(String(removed[0].detail)).toContain(`milo-${run}@example.test`);
  expect(JSON.stringify(removed[0])).not.toMatch(/token|password|hash/i);
});
