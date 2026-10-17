import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function bool(v: string | undefined): boolean | undefined {
  if (v == null || v === '') return undefined;
  return /^(1|true|yes|on)$/i.test(v);
}

/** Without SESSION_SECRET, generate one once and keep it in the data folder so sign-ins survive restarts. */
function generatedSecret(): string {
  const dir = path.resolve(process.env.DATA_DIR || './data');
  const file = path.join(dir, '.session-secret');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const port = Number(process.env.PORT || 8080);

export const config = {
  port,
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  sessionSecret: process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'change-me'
    ? process.env.SESSION_SECRET
    : generatedSecret(),
  google: googleClientId && googleClientSecret ? { clientId: googleClientId, clientSecret: googleClientSecret } : null,
  allowLocalLogin: bool(process.env.ALLOW_LOCAL_LOGIN) ?? !(googleClientId && googleClientSecret),
  kroger: process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET
    ? { clientId: process.env.KROGER_CLIENT_ID, clientSecret: process.env.KROGER_CLIENT_SECRET }
    : null,
  webDist: path.resolve(process.env.WEB_DIST || fileURLToPath(new URL('../../web/dist', import.meta.url))),
};
