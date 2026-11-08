import { expect, type Page } from '@playwright/test';

/** Makes a new account and home. The tests share one server, so after the first account the sign-in form shows first. */
export async function signUp(page: Page, name: string, username: string, homeName: string): Promise<void> {
  await page.goto('/');
  const create = page.getByRole('button', { name: 'Create an account' });
  await expect(page.getByPlaceholder('Your name').or(create)).toBeVisible();
  if (await create.isVisible()) await create.click();
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByPlaceholder('Username').fill(username);
  await page.getByPlaceholder(/^Password/).fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByPlaceholder('Home name').fill(homeName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
}
