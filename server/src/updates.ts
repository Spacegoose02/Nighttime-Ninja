// Tells people when a newer Nighttime Ninja release is out on GitHub.
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';

export const REPO = 'Spacegoose02/Nighttime-Ninja';
export const VERSION: string = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

interface Latest { version: string; url: string; notes: string; publishedAt: string; apk: string | null; exe: string | null }
let cache: { at: number; latest: Latest | null } | null = null;
const TTL = 6 * 3600e3;

/** Compares dotted versions: 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchLatest(): Promise<Latest | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.latest;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'NighttimeNinja' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const r = (await res.json()) as { tag_name: string; html_url: string; body?: string; published_at: string; assets?: { name: string; browser_download_url: string }[] };
    const asset = (re: RegExp) => r.assets?.find((a) => re.test(a.name))?.browser_download_url ?? null;
    const latest = {
      version: r.tag_name.replace(/^v/, ''), url: r.html_url, notes: (r.body ?? '').slice(0, 4000), publishedAt: r.published_at,
      apk: asset(/\.apk$/i), exe: asset(/Setup.*\.exe$/i),
    };
    cache = { at: Date.now(), latest };
    return latest;
  } catch {
    // Offline or rate limited: try again in a while rather than on every page load.
    cache = { at: Date.now() - TTL + 15 * 60e3, latest: cache?.latest ?? null };
    return cache.latest;
  }
}

export function updateRoutes(app: FastifyInstance): void {
  // Public so the Android and desktop launchers can ask too. It reveals only the version number.
  app.get('/api/version', async () => {
    const latest = await fetchLatest();
    return {
      current: VERSION,
      latest: latest?.version ?? null,
      updateAvailable: !!latest && compareVersions(latest.version, VERSION) > 0,
      releaseUrl: latest?.url ?? `https://github.com/${REPO}/releases`,
      notes: latest?.notes ?? '',
      apk: latest?.apk ?? null,
      exe: latest?.exe ?? null,
    };
  });
}
