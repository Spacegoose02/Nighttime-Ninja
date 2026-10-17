import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { XMLParser } from 'fast-xml-parser';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, requireStr, str } from '../util.ts';

export interface FeedEntry {
  feedId: string;
  feedTitle: string;
  title: string;
  link: string;
  published: string | null;
  thumbnail: string | null;
  videoId: string | null;
  summary: string | null;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });
const cache = new Map<string, { at: number; title: string; entries: Omit<FeedEntry, 'feedId' | 'feedTitle'>[] }>();
const TTL = 15 * 60e3;

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  // Skips YouTube's cookie-consent interstitial in the EU.
  cookie: 'SOCS=CAI; CONSENT=YES+',
};

async function get(url: string, browser = false): Promise<string> {
  const res = await fetch(url, {
    headers: browser ? BROWSER_HEADERS : { 'user-agent': 'Mozilla/5.0 (compatible; NighttimeNinja/0.1)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new HttpError(502, `Feed answered ${res.status}`);
  return (await res.text()).slice(0, 5_000_000);
}

const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v));

const YT_CHANNEL = /^https:\/\/www\.youtube\.com\/(?:channel\/(UC[\w-]+)\/videos|feeds\/videos\.xml\?channel_id=(UC[\w-]+))/;

/** Finds the channel id on a YouTube channel or handle page. */
export function channelIdFromHtml(html: string): string | null {
  return html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/)?.[1]
    ?? html.match(/"externalId":"(UC[\w-]{20,})"/)?.[1]
    ?? html.match(/<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{20,})"/)?.[1]
    ?? null;
}

/**
 * Turns a YouTube channel/handle link or a web page into the URL we poll.
 * YouTube channels are stored as their /videos page, because YouTube's own RSS feeds stopped working.
 */
export async function resolveFeedUrl(input: string): Promise<string> {
  let u: URL;
  try { u = new URL(input.trim()); } catch { throw new HttpError(400, 'That is not a valid link'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Only http and https links work');
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtube.com' || host === 'youtu.be') {
    const direct = u.pathname.match(/^\/channel\/(UC[\w-]+)/)?.[1] ?? u.searchParams.get('channel_id');
    if (direct) return `https://www.youtube.com/channel/${direct}/videos`;
    if (host === 'youtu.be' || u.pathname === '/watch') {
      // A video link: follow it to its channel.
      const html = await get(u.href, true);
      const id = html.match(/"channelId":"(UC[\w-]{20,})"/)?.[1];
      if (id) return `https://www.youtube.com/channel/${id}/videos`;
    } else {
      const html = await get(`https://www.youtube.com${u.pathname.replace(/\/(videos|featured|shorts|streams|about)\/?$/, '')}`, true)
        .catch(() => { throw new HttpError(422, "YouTube doesn't have a channel at that address. Check the @name and try again."); });
      const id = channelIdFromHtml(html);
      if (id) return `https://www.youtube.com/channel/${id}/videos`;
    }
    throw new HttpError(422, "Couldn't find that YouTube channel. Try the channel's page link, like youtube.com/@channelname");
  }
  const body = await get(u.href);
  if (/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000))) return u.href;
  const link = body.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
  const href = link?.match(/href=["']([^"']+)["']/i)?.[1];
  if (href) return new URL(href, u).href;
  throw new HttpError(422, "That page doesn't have an RSS feed");
}

/** Pulls the JSON object assigned to `var ytInitialData` out of a YouTube page. */
function ytInitialData(html: string): Record<string, unknown> | null {
  const at = html.indexOf('ytInitialData = ');
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/** "12d ago", "3 weeks ago", "1 year ago" -> an approximate ISO date. */
export function relativeToIso(text: string, now = Date.now()): string | null {
  const m = text.match(/(\d+)\s*(second|sec|s|minute|min|m|hour|hr|h|day|d|week|wk|w|month|mo|year|yr|y)s?\b/i);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const ms = unit.startsWith('mo') ? 30 * 864e5
    : unit.startsWith('y') ? 365 * 864e5
    : unit.startsWith('w') ? 7 * 864e5
    : unit.startsWith('d') ? 864e5
    : unit.startsWith('h') ? 36e5
    : unit === 'm' || unit.startsWith('min') ? 6e4
    : 1e3;
  return new Date(now - Number(m[1]) * ms).toISOString();
}

type Entry = Omit<FeedEntry, 'feedId' | 'feedTitle'>;

/** Reads the newest uploads from a YouTube channel's /videos page. */
export function parseYouTubeVideosPage(html: string): { title: string; entries: Entry[] } {
  const data = ytInitialData(html);
  if (!data) throw new HttpError(502, "YouTube didn't return the channel's videos");
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, any>;
    if (r.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const v = r.lockupViewModel;
      const meta = v.metadata?.lockupMetadataViewModel;
      const parts = (meta?.metadata?.contentMetadataViewModel?.metadataRows ?? []).flatMap((row: any) => row.metadataParts ?? []);
      const when = parts.map((p: any) => p.text?.content ?? '').find((t: string) => /ago/.test(t)) ?? '';
      push(v.contentId, meta?.title?.content, when);
    } else if (r.videoRenderer || r.gridVideoRenderer) {
      const v = r.videoRenderer ?? r.gridVideoRenderer;
      push(v.videoId, v.title?.runs?.[0]?.text ?? v.title?.simpleText, v.publishedTimeText?.simpleText ?? '', v.descriptionSnippet?.runs?.map((x: any) => x.text).join(''));
    }
    for (const k in r) walk(r[k]);
  };
  const push = (id: string, title: string | undefined, when: string, summary?: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    entries.push({
      title: title ?? 'Video',
      link: `https://www.youtube.com/watch?v=${id}`,
      published: relativeToIso(when),
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      videoId: id,
      summary: summary ?? null,
    });
  };
  walk(data);
  const meta = (data.metadata as Record<string, any> | undefined)?.channelMetadataRenderer;
  return { title: meta?.title ?? 'YouTube channel', entries };
}

export function parseFeed(xml: string): { title: string; entries: Omit<FeedEntry, 'feedId' | 'feedTitle'>[] } {
  const doc = parser.parse(xml);
  if (doc.feed) {
    const f = doc.feed;
    return {
      title: txt(f.title),
      entries: arr(f.entry).map((e: Record<string, unknown>) => {
        const links = arr(e.link as Record<string, string>[]);
        const href = (links.find((l) => l['@rel'] === 'alternate') ?? links[0])?.['@href'] ?? '';
        const media = e['media:group'] as Record<string, unknown> | undefined;
        const thumb = (media?.['media:thumbnail'] as Record<string, string> | undefined)?.['@url'] ?? null;
        return {
          title: txt(e.title),
          link: href,
          published: txt(e.published) || txt(e.updated) || null,
          thumbnail: thumb,
          videoId: txt(e['yt:videoId']) || null,
          summary: txt(media?.['media:description']).slice(0, 300) || txt(e.summary).slice(0, 300) || null,
        };
      }),
    };
  }
  const channel = doc.rss?.channel ?? doc['rdf:RDF']?.channel;
  const items = arr(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
  return {
    title: txt(channel?.title),
    entries: items.map((i: Record<string, unknown>) => {
      const enclosure = i.enclosure as Record<string, string> | undefined;
      const mediaThumb = (i['media:thumbnail'] as Record<string, string> | undefined)?.['@url'];
      const mediaContent = arr(i['media:content'] as Record<string, string>[]).find((m) => /image/.test(m['@type'] ?? m['@medium'] ?? ''))?.['@url'];
      const desc = txt(i.description);
      const img = desc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
      return {
        title: txt(i.title),
        link: txt(i.link),
        published: txt(i.pubDate) || txt(i['dc:date']) || null,
        thumbnail: mediaThumb ?? mediaContent ?? (enclosure?.['@type']?.startsWith('image') ? enclosure['@url'] : null) ?? img ?? null,
        videoId: null,
        summary: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
      };
    }),
  };
}

async function loadFeed(url: string) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const yt = url.match(YT_CHANNEL);
  const parsed = yt
    ? parseYouTubeVideosPage(await get(`https://www.youtube.com/channel/${yt[1] ?? yt[2]}/videos`, true))
    : parseFeed(await get(url));
  const entry = { at: Date.now(), ...parsed };
  cache.set(url, entry);
  return entry;
}

export function feedRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/feeds', async (req) => {
    const ctx = homeCtx(db, req);
    return db.prepare('SELECT id, title, url, created_at AS createdAt FROM feeds WHERE home_id = ? ORDER BY title COLLATE NOCASE').all(ctx.homeId);
  });

  app.post('/api/homes/:homeId/feeds', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const url = await resolveFeedUrl(requireStr(b.url, 'Link', 2000));
    const feed = await loadFeed(url);
    const id = newId();
    db.prepare('INSERT INTO feeds (id, home_id, title, url) VALUES (?, ?, ?, ?)').run(id, ctx.homeId, str(b.title, 120) ?? (feed.title || url), url);
    return { id, title: str(b.title, 120) ?? feed.title, url };
  });

  app.delete('/api/homes/:homeId/feeds/:id', async (req) => {
    const ctx = homeCtx(db, req);
    db.prepare('DELETE FROM feeds WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  app.get('/api/homes/:homeId/feeds/items', async (req) => {
    const ctx = homeCtx(db, req);
    const feeds = db.prepare('SELECT id, title, url FROM feeds WHERE home_id = ?').all(ctx.homeId) as Row[];
    const results = await Promise.allSettled(feeds.map(async (f) => {
      const data = await loadFeed(f.url as string);
      return data.entries.slice(0, 30).map((e) => ({ ...e, feedId: f.id as string, feedTitle: f.title as string }));
    }));
    const entries = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    entries.sort((a, b) => Date.parse(b.published ?? '0') - Date.parse(a.published ?? '0'));
    const failed = feeds.filter((_, i) => results[i].status === 'rejected').map((f) => f.title);
    return { entries: entries.slice(0, 200), failed };
  });
}
