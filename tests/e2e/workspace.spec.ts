import { expect, test, type Page } from '@playwright/test';

// Frontend workspace behaviour: navigation, search, filters, review outcomes and derived counts.
// Runs against the static build with no backend and no API key.
async function ready(page: Page) {
  await page.goto('#/');
  await expect(page.getByTestId('overview-metrics')).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Documents are ready for analysis')).toBeVisible({ timeout: 90000 });
}
const num = async (page: Page, id: string) => Number((await page.getByTestId(id).innerText()).match(/\d+/)![0]);

test('every primary navigation destination opens without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await ready(page);
  await expect(page).toHaveTitle('MedGuard — Healthcare Contradiction Detection');
  await expect(page.getByRole('link', { name: 'MedGuard home' }).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  for (const [link, heading] of [['Clinical Cases', 'Clinical Cases'], ['Contradictions', 'Contradictions'], ['Documents', 'Documents'], ['Review Queue', 'Review Queue'], ['Activity', 'Activity'], ['Overview', 'Clinical Overview']]) {
    await nav.getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  }
  for (const [link, heading] of [['Settings', 'Settings'], ['Help & About', 'Help & About']]) {
    await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  }
  expect(errors).toEqual([]);
});

test('global search (Ctrl+K) finds a case and opens it; empty results are explained', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await page.getByTestId('palette-input').fill('zzzz-no-match');
  await expect(page.getByTestId('command-palette')).toContainText('No results');
  await page.getByTestId('palette-input').fill('DEMO-0107');
  await expect(page.getByTestId('palette-result').first()).toContainText('DEMO-0107');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/cases\/case_/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('DEMO-0107');
  await expect(page.getByText('SYNTHETIC DEMONSTRATION DATA')).toBeVisible();
});

test('case search, severity filter and sorting operate on real data', async ({ page }) => {
  await ready(page);
  await page.goto('#/cases');
  await expect(page.getByTestId('cases-table').getByTestId('case-link')).toHaveCount(6);
  await page.getByTestId('case-search').fill('0118');
  await expect(page.getByTestId('cases-table').getByTestId('case-link')).toHaveCount(1);
  await page.getByRole('button', { name: /Remove filter/ }).click();
  await page.getByTestId('case-sort').selectOption('id');
  await expect(page.getByTestId('cases-table').getByTestId('case-link').first()).toHaveText('DEMO-0042');

  await page.goto('#/contradictions');
  await page.getByTestId('filter-severity').selectOption('high');
  const badges = page.getByTestId('queue-table').getByTestId('severity-badge');
  await expect(badges.first()).toBeVisible();
  for (const t of await badges.allInnerTexts()) expect(t).toContain('High');
});

test('selecting a finding in the case workspace shows its own evidence', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-demo-case').click();
  await page.getByTestId('analyze-button').first().click();
  await expect(page.getByTestId('case-findings')).toBeVisible({ timeout: 30000 });
  const item = page.getByTestId('case-finding-item').filter({ hasText: 'Penicillin' });
  await item.click();
  await expect(page.getByTestId('case-selected-finding')).toContainText('Penicillin');
  await expect(page.getByTestId('evidence-side-B').getByTestId('evidence-quote').first()).toContainText('No known drug allergies');
});

test('a review-queue decision updates the queue, dashboard counts and activity log, and persists', async ({ page }) => {
  await ready(page);
  const pendingBefore = await num(page, 'metric-pending');
  await page.goto('#/queue');
  const first = page.getByTestId('review-item').first();
  const title = (await first.locator('div').nth(1).innerText()).trim();
  await first.click();
  const ws = page.getByTestId('review-workspace');
  // A temporal / expected-change outcome needs a rationale.
  await ws.getByRole('button', { name: 'Temporal difference / expected change' }).click();
  await page.getByTestId('confirm-decision').click();
  await expect(page.getByRole('alert').filter({ hasText: 'reason of at least' })).toBeVisible();
  await page.getByTestId('reason-input').fill('Later record documents the change.');
  await page.getByTestId('confirm-decision').click();
  await expect(page.getByText(/→ Expected change/).first()).toBeVisible();
  await expect(page.getByTestId('review-list')).not.toContainText(title);

  await page.goto('#/');
  await expect.poll(() => num(page, 'metric-pending')).toBe(pendingBefore - 1);
  await page.goto('#/activity?origin=local');
  await expect(page.getByTestId('timeline-events')).toContainText('→ Expected change');
  await page.reload();
  await expect(page.getByTestId('timeline-events')).toContainText('Later record documents the change.');
});

test('needs-more-information keeps a finding pending and is offered from the contradictions drawer', async ({ page }) => {
  await ready(page);
  await page.goto('#/contradictions?q=furosemide');
  await page.getByTestId('preview-finding').first().click();
  const drawer = page.getByTestId('finding-drawer');
  await expect(drawer.getByTestId('evidence-side-A')).toBeVisible();
  await expect(drawer.getByTestId('status-badge').first()).toHaveText('Needs more information'); // seeded example
  await drawer.getByRole('button', { name: 'Confirm discrepancy' }).click();
  await page.getByTestId('confirm-decision').click();
  await expect(drawer.getByTestId('status-badge').first()).toHaveText('Confirmed discrepancy');
});

test('the sign-in card is shown once, outside the header buttons, and stays put when the demo finishes loading', async ({ page }) => {
  await page.goto('#/');
  const signIn = page.getByTestId('entry-sign-in');
  await expect(signIn).toBeVisible();
  await expect(page.getByTestId('open-demo-case')).toBeVisible(); // demo finished loading
  await expect(page.getByTestId('entry-choices')).toHaveCount(1);
  await expect(page.getByTestId('open-demo-case').getByTestId('entry-choices')).toHaveCount(0);
  // Its buttons do what they say (no surrounding link hijacks the click).
  await signIn.click();
  await expect(page).toHaveURL(/#\/settings/);
});
