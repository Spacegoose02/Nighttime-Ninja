import { expect, test } from '@playwright/test';

// A camera that shows one EAN-13 barcode, drawn on a canvas. Chromium on Linux has no built-in barcode reader,
// so this exercises the bundled one (WebAssembly) through the server's real security headers.
const CODE = '0049000028911';

test('sign in, set up a home, shop for something into the pantry, and scan a barcode', async ({ page }) => {
  await page.addInitScript((code) => {
    const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
    const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
    const FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
    const d = code.split('').map(Number);
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (FIRST[d[0]][i - 1] === 'L' ? L : G)[d[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[d[i]];
    bits += '101';
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      const draw = () => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#000';
        [...bits].forEach((b, i) => { if (b === '1') ctx.fillRect(40 + i * 5, 100, 5, 250); });
      };
      draw();
      setInterval(draw, 100);
      return canvas.captureStream(10);
    };
  }, CODE);

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

  // Scanning: the camera's barcode lands in a new pantry item.
  await page.goto('/inventory');
  await page.getByRole('button', { name: /Scan/ }).first().click();
  await expect(page.locator('dialog[open] input').filter({ hasValue: CODE })).toBeVisible({ timeout: 15_000 });
});
