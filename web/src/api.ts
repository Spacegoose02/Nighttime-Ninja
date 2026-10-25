import type { Ingredient, Recipe } from '../../shared/recipe.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Request failed (${res.status})`);
  // Slow routes answer 200 straight away to keep proxies from timing out, then put any failure in the body.
  if (res.headers.get('x-nn-deferred') && typeof (data as { error?: unknown })?.error === 'string') {
    const d = data as { error: string; status?: number };
    throw new ApiError(d.status ?? 500, d.error);
  }
  return data as T;
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
  isLow: boolean; markedLow: boolean; updatedAt: string;
}

export interface ShoppingItem {
  id: string; name: string; quantity: number | null; unit: string | null; category: string; note: string | null;
  checked: boolean; createdAt: string; checkedAt: string | null; addedBy: string | null;
}

export type Availability = 'have' | 'low' | 'missing' | 'unknown';

export interface RecipeSummary {
  id: string; title: string; image: string | null; servings: number | null; tags: string[]; totalMinutes: number | null;
  ingredientCount: number; isPublic: boolean; ready: 'ready' | 'almost' | 'missing'; missing: string[];
}

export interface RecipeFull extends Recipe {
  id: string; isPublic: boolean; shareSlug: string | null; status: 'ready' | 'almost' | 'missing'; missing: string[];
  ingredients: (Ingredient & { availability: Availability; matched?: string[]; linked?: boolean })[];
}

export interface Meal {
  id: string; date: string; slot: string; recipeId: string | null; title: string; image: string | null; note: string | null; cookedAt: string | null;
}

export interface HomeDetail {
  id: string; name: string; role: 'manager' | 'member'; joinCode: string; calendarUrl: string | null;
  members: { id: string; name: string; avatar: string; role: string; joined_at: string }[];
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
