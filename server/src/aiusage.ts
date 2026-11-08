// What the AI helpers cost: tokens per model per day, and an estimate in US dollars from Claude's list prices.
// Your own AI server is counted too, at no cost.
import type { DatabaseSync } from 'node:sqlite';

/** US dollars per million tokens, input and output. Cache reads cost a tenth of input; cache writes 1.25×. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Estimated cost in US dollars, or null for a model without a known price (your own server costs nothing). */
export function usageCost(model: string, u: Usage, local = false): number | null {
  if (local) return 0;
  const p = PRICES[model];
  if (!p) return null;
  const input = (u.input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0);
  return (input * p.input + (u.output_tokens ?? 0) * p.output) / 1e6;
}

export function recordUsage(db: DatabaseSync, model: string, u: Usage | null | undefined, local = false): void {
  const day = new Date().toISOString().slice(0, 10);
  const input = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);
  const cost = u ? usageCost(model, u, local) ?? 0 : 0;
  db.prepare(`INSERT INTO ai_usage (day, model, requests, input_tokens, output_tokens, cost) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT (day, model) DO UPDATE SET requests = requests + 1, input_tokens = input_tokens + excluded.input_tokens,
    output_tokens = output_tokens + excluded.output_tokens, cost = cost + excluded.cost`)
    .run(day, model, input, u?.output_tokens ?? 0, cost);
}

export interface UsageSummary {
  today: { requests: number; cost: number };
  month: { requests: number; cost: number; inputTokens: number; outputTokens: number };
  byModel: { model: string; requests: number; cost: number }[];
}

/** Today, this calendar month, and this month by model. */
export function usageSummary(db: DatabaseSync): UsageSummary {
  const today = new Date().toISOString().slice(0, 10);
  const month = `${today.slice(0, 7)}-01`;
  const t = db.prepare('SELECT COALESCE(SUM(requests), 0) AS r, COALESCE(SUM(cost), 0) AS c FROM ai_usage WHERE day = ?').get(today) as { r: number; c: number };
  const m = db.prepare('SELECT COALESCE(SUM(requests), 0) AS r, COALESCE(SUM(cost), 0) AS c, COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o FROM ai_usage WHERE day >= ?').get(month) as { r: number; c: number; i: number; o: number };
  const byModel = db.prepare('SELECT model, SUM(requests) AS requests, SUM(cost) AS cost FROM ai_usage WHERE day >= ? GROUP BY model ORDER BY cost DESC, requests DESC').all(month) as { model: string; requests: number; cost: number }[];
  return { today: { requests: t.r, cost: t.c }, month: { requests: m.r, cost: m.c, inputTokens: m.i, outputTokens: m.o }, byModel };
}
