import { convert, formatQuantity, isMetric, normalizeUnit, toUS } from '../../shared/units.ts';

/** Formats an amount for display in the user's preferred measurement system. */
export function amount(qty: number | null | undefined, unit: string | null | undefined, pref: 'us' | 'metric' | 'original' = 'us'): string {
  if (qty == null) return unit ?? '';
  if (qty < 0) return `-${amount(-qty, unit, pref)}`;
  let q = qty;
  let u = normalizeUnit(unit ?? '') ?? unit ?? null;
  if (pref === 'us' && isMetric(u)) ({ quantity: q, unit: u } = toUS(q, u));
  if (pref === 'metric' && u && !isMetric(u)) {
    const g = convert(q, u, 'g');
    const ml = convert(q, u, 'ml');
    if (g != null) ({ q, u } = g >= 1000 ? { q: g / 1000, u: 'kg' } : { q: Math.round(g), u: 'g' });
    else if (ml != null) ({ q, u } = ml >= 1000 ? { q: ml / 1000, u: 'l' } : { q: Math.round(ml), u: 'ml' });
  }
  const n = pref === 'metric' ? String(Math.round(q * 100) / 100) : formatQuantity(q);
  if (!u || u === 'each') return n;
  const plural = q > 1 && !['tsp', 'tbsp', 'fl oz', 'oz', 'lb', 'g', 'kg', 'ml', 'l', 'mg', 'cl', 'dl'].includes(u) ? `${u}s` : u;
  return `${n} ${plural}`;
}

export function minutes(m: number | null | undefined): string {
  if (!m) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
}

export const todayIso = (): string => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
