import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// One end-to-end check of the real app: the built web app served by the real server, on a fresh, empty database.
// Run `npm run build` first, then `npm run test:e2e`.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:8098', ...devices['Pixel 7'] },
  webServer: {
    command: 'node server/src/index.ts',
    url: 'http://127.0.0.1:8098/api/health',
    env: { PORT: '8098', HOST: '127.0.0.1', DATA_DIR: dataDir },
    reuseExistingServer: false,
  },
});
