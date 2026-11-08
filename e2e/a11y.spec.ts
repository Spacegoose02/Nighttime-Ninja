import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signUp } from './helpers.ts';

// Automated accessibility checks on the main pages. They catch missing labels, low contrast, broken ARIA and the like,
// so fixes stay fixed. Serious and critical problems fail the build.
const PAGES = ['/', '/inventory', '/recipes', '/shopping', '/plan', '/settings'];

async function audit(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `${where}: ${v.id} (${v.impact}) ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`).join('\n');
  expect(report).toBe('');
}

test('the main pages have no serious accessibility problems', async ({ page }) => {
  await page.goto('/');
  await audit(page, 'sign-in');
  await signUp(page, 'Axe Tester', 'axe', 'Axe Kitchen');
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await audit(page, path);
  }
});

const THEMES = ['forest', 'midnight', 'citrus', 'raccoon', 'berry', 'ocean', 'sunset', 'lavender', 'mint', 'arctic', 'espresso', 'neon', 'sweettea', 'peach', 'pistachio', 'blueberry', 'castiron', 'bourbon', 'contrast'];

test('every theme has readable text', async ({ page }) => {
  await signUp(page, 'Theme Tester', 'themes', 'Theme Kitchen');
  const me = await (await page.request.get('/api/me')).json();
  await page.request.post(`/api/homes/${me.homes[0].id}/sample-data`, { data: {} });
  for (const theme of THEMES) {
    await page.request.patch('/api/me', { data: { theme } });
    for (const path of ['/', '/recipes', '/shopping']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      const report = violations.flatMap((v) => v.nodes.slice(0, 4).map((n) => `${theme} ${path}: ${n.target.join(' ')} ${n.any[0]?.message ?? ''}`)).join('\n');
      expect.soft(report).toBe('');
    }
  }
});
