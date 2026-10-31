import type { Ingredient, Recipe } from '../../shared/recipe.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Names this browser tab in every request, so live updates can skip the tab's own changes.
 * (Not crypto.randomUUID: that only exists on https, and plenty of home servers are plain http.)
 */
export const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: { 'x-nn-client': CLIENT_ID, ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    // Maybe the sign-in ran out or was signed out from another device: let the app check (see state.tsx).
    if (res.status === 401 && path !== '/api/me') window.dispatchEvent(new Event('nn-unauthorized'));
    throw new ApiError(res.status, (data as { error?: string })?.error ?? `Request failed (${res.status})`);
  }
  // Slow routes answer 200 straight away to keep proxies from timing out, then put any failure in the body.
  if (res.headers.get('x-nn-deferred') && typeof (data as { error?: unknown })?.error === 'string') {
    const d = data as { error: string; status?: number };
    throw new ApiError(d.status ?? 500, d.error);
  }
  return data as T;
}

/**
 * POSTs to a route that can stream (the AI chats). onText gets the reply as it's written; the promise resolves
 * with the final answer, which replaces the preview.
 */
export async function apiStream<T = unknown>(path: string, body: unknown, onText: (text: string) => void): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson', 'x-nn-client': CLIENT_ID },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok || !res.body || !res.headers.get('content-type')?.includes('ndjson')) {
    const data = safeJson(await res.text()) as { error?: string; status?: number } | null;
    if (!res.ok || typeof data?.error === 'string') throw new ApiError(data?.status ?? res.status, data?.error ?? `Request failed (${res.status})`);
    return data as T;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { type: string; text?: string; error?: string; status?: number };
      if (msg.type === 'text') onText(msg.text ?? '');
      else if (msg.type === 'error') throw new ApiError(msg.status ?? 500, msg.error ?? 'Something went wrong');
      else if (msg.type === 'done') return msg as T;
    }
  }
  throw new ApiError(502, 'The connection dropped before the reply finished. Try again.');
}

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return t; }
}

export interface Me {
  user: { id: string; name: string; email: string | null; avatar: string; theme: string; units: 'us' | 'metric' | 'original'; isAdmin: boolean; lastHomeId: string | null };
  homes: { id: string; name: string; role: 'manager' | 'member' }[];
}

export interface Item {
  id: string; name: string; category: string; location: string; icon: string | null; photo: string | null;
  quantity: number; unit: string | null; lowThreshold: number | null; barcode: string | null; expiresOn: string | null;
  isLow: boolean; markedLow: boolean; onShoppingList: boolean; updatedAt: string;
  /** When it went into the freezer. */
  frozenOn: string | null;
}

export interface ShoppingItem {
  id: string; name: string; quantity: number | null; unit: string | null; category: string; note: string | null;
  checked: boolean; createdAt: string; checkedAt: string | null; addedBy: string | null;
  /** What it cost when bought, and what it cost the time before. */
  price?: number | null; store?: string | null; lastPrice?: number | null;
}

export type Availability = 'have' | 'low' | 'missing' | 'unknown';

export interface RecipeSummary {
  id: string; title: string; image: string | null; servings: number | null; tags: string[]; totalMinutes: number | null;
  ingredientCount: number; isPublic: boolean; ready: 'ready' | 'almost' | 'missing'; missing: string[];
  /** Pantry items expiring in the next 3 days that this recipe would use. */
  usesExpiring: string[];
  favorite: boolean; rating: number | null; collections: string[];
  /** How many ingredients clash with someone's diet or allergy. */
  dietWarnings: number;
}

export interface RecipeFull extends Recipe {
  id: string; isPublic: boolean; shareSlug: string | null; status: 'ready' | 'almost' | 'missing'; missing: string[];
  ingredients: (Ingredient & { availability: Availability; matched?: string[]; linked?: boolean })[];
  favorite: boolean; rating: number | null; notes: string; cookCount: number; lastCooked: string | null; collections: string[];
  dietClashes: { ingredient: string; person: string; reason: string }[];
  nutrition: Nutrition | null;
}

/** Per serving, estimated by AI. */
export interface Nutrition { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; sugarG: number; sodiumMg: number; servings: number }

export interface Meal {
  id: string; date: string; slot: string; recipeId: string | null; title: string; image: string | null; note: string | null; cookedAt: string | null;
  cookId: string | null; cookName: string | null;
}

export interface HomeDetail {
  id: string; name: string; role: 'manager' | 'member'; joinCode: string; calendarUrl: string | null;
  members: { id: string; name: string; avatar: string; role: string; joined_at: string; diets: string[]; allergies: string[] }[];
  settings: { zipCode: string | null; stores: string[]; krogerLocationId: string | null; locations: string[]; categories: string[] };
}

/** Reads an image file into a data URL, shrinking big photos so uploads stay small. */
export async function fileToDataUrl(file: File, maxSize = 1200): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pantry tile color: red when it's out or on the shopping list, yellow when low, green otherwise. */
export function tileState(i: Pick<Item, 'quantity' | 'isLow' | 'onShoppingList'>): { cls: string; badge: string | null } {
  if (i.quantity <= 0) return { cls: ' out', badge: 'OUT' };
  if (i.onShoppingList) return { cls: ' out', badge: 'ON LIST' };
  if (i.isLow) return { cls: ' low', badge: 'LOW' };
  return { cls: '', badge: null };
}

/** Months something has been in the freezer, once it's been there 3 months or more (best quality ends around then). */
export function freezerMonths(i: Pick<Item, 'frozenOn'>): number | null {
  if (!i.frozenOn) return null;
  const months = Math.floor((Date.now() - Date.parse(`${i.frozenOn}T12:00:00`)) / (30.44 * 86400000));
  return months >= 3 ? months : null;
}
