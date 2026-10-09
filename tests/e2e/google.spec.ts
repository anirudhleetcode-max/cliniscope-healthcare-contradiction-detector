import { expect, test } from '@playwright/test';

// The Google redirect landing page. The full Google flow is covered by tests/unit/google.test.ts
// against a fake provider; a real Google account cannot be driven from CI.
test('Google sign-in errors are explained and never sign the user in', async ({ page }) => {
  await page.goto('#/auth/google?error=account_exists');
  await expect(page.getByTestId('google-error')).toContainText('Sign in with your password, then use "Link Google account"');
  await page.goto('#/auth/google?error=cancelled');
  await expect(page.getByTestId('google-error')).toHaveText('Google sign-in was cancelled.');
  await page.goto('#/settings#workspace');
  await expect(page.getByTestId('signed-in-as')).toHaveCount(0);
});

test('a forged hand-off code does not create a session', async ({ page }) => {
  await page.goto('#/auth/google?handoff=forged-handoff-code-0000000000');
  await expect(page.getByTestId('google-error')).toContainText('could not be completed');
  expect(await page.evaluate(() => sessionStorage.getItem('medguard.session'))).toBeNull();
});
