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

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; NighttimeNinja/0.1)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new HttpError(502, `Feed answered ${res.status}`);
  return (await res.text()).slice(0, 5_000_000);
}

const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v));

/** Turns a YouTube channel/handle link or a web page into its RSS/Atom feed URL. */
export async function resolveFeedUrl(input: string): Promise<string> {
  let u: URL;
  try { u = new URL(input.trim()); } catch { throw new HttpError(400, 'That is not a valid link'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Only http and https links work');
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtube.com') {
    if (u.pathname.startsWith('/feeds/')) return u.href;
    const channel = u.pathname.match(/^\/channel\/(UC[\w-]+)/);
    if (channel) return `https://www.youtube.com/feeds/videos.xml?channel_id=${channel[1]}`;
    const list = u.searchParams.get('list');
    if (list) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`;
    const html = await get(u.href);
    const id = html.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/)?.[1] ?? html.match(/channel_id=(UC[\w-]{20,})/)?.[1];
    if (id) return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    throw new HttpError(422, "Couldn't find that YouTube channel's feed");
  }
  const body = await get(u.href);
  if (/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000))) return u.href;
  const link = body.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
  const href = link?.match(/href=["']([^"']+)["']/i)?.[1];
  if (href) return new URL(href, u).href;
  throw new HttpError(422, "That page doesn't have an RSS feed");
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
  const parsed = parseFeed(await get(url));
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
