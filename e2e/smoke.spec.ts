import { expect, test } from '@playwright/test';

test('sign in, set up a home, and shop for something into the pantry', async ({ page }) => {
  await page.goto('/');
  // A fresh install starts by creating its first (admin) account.
  await page.getByPlaceholder('Your name').fill('Smoke Tester');
  await page.getByPlaceholder('Username').fill('smoke');
  await page.getByPlaceholder(/^Password/).fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByPlaceholder('Home name').fill('Test Kitchen');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  // Phone layout: four tabs and More.
  const tabs = page.getByRole('navigation', { name: 'Main' }).last();
  await tabs.getByRole('link', { name: /Shopping/ }).click();
  await page.getByPlaceholder(/Quick add/).fill('3 avocados');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Check off avocados' }).click();
  await expect(page.getByRole('button', { name: 'Uncheck avocados' })).toBeVisible();

  // Checked-off items land in the pantry.
  await tabs.getByRole('link', { name: /Pantry/ }).click();
  await expect(page.getByText('avocados', { exact: false }).first()).toBeVisible();

  // A page that loads on demand, reached through More.
  await tabs.getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: /Settings/ }).click();
  await expect(page.getByRole('heading', { name: 'You' })).toBeVisible();
});
