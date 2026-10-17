import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { config } from '../config.ts';
import { HttpError, str } from '../util.ts';

export interface Store {
  id: string;
  name: string;
  color: string;
  search: (q: string) => string;
  weeklyAd: string;
  coupons: string;
}

// Only Kroger offers a public product/price API. The rest get deep links to their own search, ads and coupons.
export const STORES: Store[] = [
  { id: 'walmart', name: 'Walmart', color: '#0071ce', search: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`, weeklyAd: 'https://www.walmart.com/shop/deals', coupons: 'https://www.walmart.com/shop/deals/rollbacks' },
  { id: 'foodlion', name: 'Food Lion', color: '#00539b', search: (q) => `https://shop.foodlion.com/search?search_term=${encodeURIComponent(q)}`, weeklyAd: 'https://www.foodlion.com/weekly-specials', coupons: 'https://www.foodlion.com/savings/coupons/browse' },
  { id: 'kroger', name: 'Kroger', color: '#21409a', search: (q) => `https://www.kroger.com/search?query=${encodeURIComponent(q)}`, weeklyAd: 'https://www.kroger.com/weeklyad', coupons: 'https://www.kroger.com/savings/cl/coupons/' },
  { id: 'bjs', name: "BJ's", color: '#d71920', search: (q) => `https://www.bjs.com/search/${encodeURIComponent(q)}`, weeklyAd: 'https://www.bjs.com/weeklyAd', coupons: 'https://www.bjs.com/myCoupons' },
  { id: 'samsclub', name: "Sam's Club", color: '#0067a0', search: (q) => `https://www.samsclub.com/s/${encodeURIComponent(q)}`, weeklyAd: 'https://www.samsclub.com/instant-savings', coupons: 'https://www.samsclub.com/instant-savings' },
  { id: 'target', name: 'Target', color: '#cc0000', search: (q) => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`, weeklyAd: 'https://www.target.com/weeklyad', coupons: 'https://www.target.com/circle/deals' },
  { id: 'aldi', name: 'ALDI', color: '#00005f', search: (q) => `https://www.aldi.us/results?q=${encodeURIComponent(q)}`, weeklyAd: 'https://www.aldi.us/weekly-specials/our-weekly-ads', coupons: 'https://www.aldi.us/weekly-specials' },
  { id: 'publix', name: 'Publix', color: '#3b8132', search: (q) => `https://delivery.publix.com/store/publix/s?k=${encodeURIComponent(q)}`, weeklyAd: 'https://www.publix.com/savings/weekly-ad', coupons: 'https://www.publix.com/savings/digital-coupons' },
];

let krogerToken: { value: string; expires: number } | null = null;

async function kroger<T>(path: string): Promise<T> {
  if (!config.kroger) throw new HttpError(404, 'Kroger is not set up on this server');
  if (!krogerToken || krogerToken.expires < Date.now()) {
    const res = await fetch('https://api.kroger.com/v1/connect/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${config.kroger.clientId}:${config.kroger.clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials&scope=product.compact',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new HttpError(502, 'Kroger sign-in failed. Check KROGER_CLIENT_ID and KROGER_CLIENT_SECRET.');
    const j = (await res.json()) as { access_token: string; expires_in: number };
    krogerToken = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  }
  const res = await fetch(`https://api.kroger.com${path}`, {
    headers: { authorization: `Bearer ${krogerToken.value}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new HttpError(502, `Kroger answered ${res.status}`);
  return (await res.json()) as T;
}

interface KrogerProduct {
  productId: string;
  description: string;
  brand?: string;
  images?: { perspective: string; sizes: { size: string; url: string }[] }[];
  items?: { size?: string; price?: { regular: number; promo: number } }[];
}

export interface Deal {
  store: string;
  name: string;
  brand: string | null;
  size: string | null;
  price: number | null;
  salePrice: number | null;
  onSale: boolean;
  image: string | null;
  url: string;
}

async function krogerSearch(term: string, locationId: string, limit = 12): Promise<Deal[]> {
  const j = await kroger<{ data: KrogerProduct[] }>(`/v1/products?filter.term=${encodeURIComponent(term)}&filter.locationId=${encodeURIComponent(locationId)}&filter.limit=${limit}`);
  return j.data.map((p) => {
    const item = p.items?.[0];
    const regular = item?.price?.regular || null;
    const promo = item?.price?.promo || null;
    const front = p.images?.find((i) => i.perspective === 'front') ?? p.images?.[0];
    return {
      store: 'kroger',
      name: p.description,
      brand: p.brand ?? null,
      size: item?.size ?? null,
      price: regular,
      salePrice: promo && regular && promo < regular ? promo : null,
      onSale: !!(promo && regular && promo < regular),
      image: front?.sizes.find((s) => s.size === 'medium')?.url ?? front?.sizes[0]?.url ?? null,
      url: `https://www.kroger.com/p/${p.productId}`,
    };
  });
}

function storeLinks(stores: string[], q: string) {
  return STORES.filter((s) => stores.includes(s.id)).map((s) => ({
    id: s.id, name: s.name, color: s.color, searchUrl: q ? s.search(q) : null, weeklyAdUrl: s.weeklyAd, couponsUrl: s.coupons,
  }));
}

export function dealRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/stores', async () => ({
    stores: STORES.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    krogerApi: !!config.kroger,
  }));

  app.get('/api/homes/:homeId/deals', async (req) => {
    const ctx = homeCtx(db, req);
    const q = str((req.query as Row).q, 100) ?? '';
    const settings = db.prepare('SELECT stores, kroger_location_id FROM home_settings WHERE home_id = ?').get(ctx.homeId) as Row | undefined;
    const stores = JSON.parse((settings?.stores as string) ?? '[]') as string[];
    let live: Deal[] = [];
    let liveError: string | null = null;
    if (q && config.kroger && settings?.kroger_location_id && stores.includes('kroger')) {
      try { live = await krogerSearch(q, settings.kroger_location_id as string); } catch (e) { liveError = (e as Error).message; }
    }
    return { stores: storeLinks(stores, q), live, liveError };
  });

  // Checks every unchecked shopping-list item for a Kroger sale.
  app.get('/api/homes/:homeId/deals/my-list', async (req) => {
    const ctx = homeCtx(db, req);
    const settings = db.prepare('SELECT kroger_location_id FROM home_settings WHERE home_id = ?').get(ctx.homeId) as Row | undefined;
    if (!config.kroger || !settings?.kroger_location_id) return { available: false, deals: [] };
    const names = (db.prepare('SELECT DISTINCT name FROM shopping_items WHERE home_id = ? AND checked = 0 LIMIT 25').all(ctx.homeId) as Row[]).map((r) => r.name as string);
    const results = await Promise.allSettled(names.map((n) => krogerSearch(n, settings.kroger_location_id as string, 6)));
    const deals = results.flatMap((r, i) => (r.status === 'fulfilled' ? r.value.filter((d) => d.onSale).map((d) => ({ ...d, forItem: names[i] })) : []));
    return { available: true, deals };
  });

  app.get('/api/deals/kroger/locations', async (req) => {
    const zip = str((req.query as Row).zip, 10);
    if (!zip || !/^\d{5}$/.test(zip)) throw new HttpError(400, 'Enter a 5-digit ZIP code');
    const j = await kroger<{ data: { locationId: string; name: string; chain: string; address: { addressLine1: string; city: string; state: string } }[] }>(
      `/v1/locations?filter.zipCode.near=${zip}&filter.limit=15`,
    );
    return j.data.map((l) => ({ id: l.locationId, name: l.name, chain: l.chain, address: `${l.address.addressLine1}, ${l.address.city}, ${l.address.state}` }));
  });
}
