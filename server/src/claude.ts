// Talking to Claude, shared by the Mixologist, the Chef and saved AI chats: which model, the client, the per-person
// cap on requests, turning API errors into messages a person can act on, and keeping slow answers alive through proxies.
import Anthropic from '@anthropic-ai/sdk';
import type { FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting, type HomeCtx } from './auth.ts';
import { config } from './config.ts';
import { rateLimit } from './security.ts';
import { HttpError } from './util.ts';

// Models that take the server-side refusal fallback. Others just run without it.
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/** The models an admin can pick in Settings. ANTHROPIC_MODEL can name any other one. */
export const MODEL_CHOICES = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', blurb: 'Best drinks, the default' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', blurb: 'Faster, about half the price' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', blurb: 'Quickest and cheapest' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', blurb: 'Most capable, priciest' },
];

/** An admin's pick in Settings wins over ANTHROPIC_MODEL. */
export function mixologistModel(db: DatabaseSync): string | null {
  if (!config.anthropic) return null;
  return getSetting(db, 'mixologistModel') ?? config.anthropic.model;
}

/** Models that take the newer web tools, which filter search results before they reach Claude. */
const FILTERED_WEB_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6']);

/** Whether Gordy and Rocco may search the web. On unless an admin turns it off in Settings. */
export function aiWebAccess(db: DatabaseSync): boolean {
  return getSetting(db, 'aiWebAccess') !== 'off';
}

/**
 * Claude's own web search and web fetch, run by Anthropic, so there's nothing extra to host or sign up for.
 * Each search is billed to the server's Claude key, so a reply gets at most a few of each.
 */
export function webTools(db: DatabaseSync): Anthropic.Beta.BetaToolUnion[] {
  const model = mixologistModel(db);
  if (!model || !aiWebAccess(db)) return [];
  const pages = { max_uses: 3, max_content_tokens: 20000, citations: { enabled: true } };
  return FILTERED_WEB_MODELS.has(model)
    ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }, { type: 'web_fetch_20260209', name: 'web_fetch', ...pages }]
    : [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, { type: 'web_fetch_20250910', name: 'web_fetch', ...pages }];
}

let client: Anthropic | null = null;

export function claude(db: DatabaseSync): { client: Anthropic; model: string } {
  if (!config.anthropic) throw new HttpError(503, 'The Mixologist needs a Claude API key. Add ANTHROPIC_API_KEY to the server settings and restart.');
  // A new key (tests swap it) gets a new client; the SDK keeps the key and fetch it was made with.
  if (client?.apiKey !== config.anthropic.apiKey) client = new Anthropic({ apiKey: config.anthropic.apiKey });
  return { client, model: mixologistModel(db)! };
}

/**
 * Each AI request can cost real money on the server owner's Claude key, so cap how many one person (or one home's
 * API token) can send. AI_MESSAGES_PER_HOUR changes the cap; 0 turns it off.
 */
export function limitAi(ctx: HomeCtx): void {
  const perHour = Number(process.env.AI_MESSAGES_PER_HOUR ?? 30);
  if (!(perHour > 0)) return;
  rateLimit(`ai:${ctx.user?.id ?? `home:${ctx.homeId}`}`, perHour, 3600e3,
    (mins) => `That's a lot of questions for one hour. Gordy and Rocco need a break; try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
}

/** Claude's own explanation from an API error, e.g. "model: claude-x is not available". */
function claudeMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? err.message;
}

/** Asks Claude. onText, when given, hears the reply's text as it's written. */
export async function ask(db: DatabaseSync, params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model' | 'max_tokens'>, onText?: (text: string) => void): Promise<Anthropic.Beta.BetaMessage> {
  const { client, model } = claude(db);
  const { output_config, ...rest } = params;
  const send = (withFallback: boolean) => {
    const stream = client.beta.messages.stream({
      ...rest,
      model,
      max_tokens: 16000,
      output_config: { effort: 'medium', ...output_config },
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (onText) stream.on('text', onText);
    return stream.finalMessage();
  };
  try {
    try {
      return await send(FALLBACK_MODELS.has(model));
    } catch (err) {
      // Not every account can use the refusal fallback yet. If Claude turns the request down, try once without it.
      if (!(err instanceof Anthropic.BadRequestError) || !FALLBACK_MODELS.has(model)) throw err;
      console.warn('Mixologist: retrying without the refusal fallback:', claudeMessage(err));
      return await send(false);
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'Claude rejected the API key. Check ANTHROPIC_API_KEY.');
    if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
      throw new HttpError(502, `Claude can't use ${model} with this API key. Pick another model in Settings → Server admin. (${claudeMessage(err)})`);
    }
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The Mixologist is getting a lot of orders. Try again in a minute.');
    if (err instanceof Anthropic.APIError) {
      console.error('Mixologist: Claude API error', err.status, claudeMessage(err));
      throw new HttpError(502, `Claude answered ${err.status ?? 'with a network error'}: ${claudeMessage(err)}`);
    }
    throw err;
  }
}

/**
 * The reply's text. Text blocks that sit next to each other are one passage (a cited answer comes back split
 * into pieces at each citation), so they join as they are; a tool call or search in between starts a new paragraph.
 */
export function textOf(m: Anthropic.Beta.BetaMessage): string {
  const parts: string[] = [];
  let joined = false;
  for (const b of m.content) {
    if (b.type === 'text') {
      if (joined) parts[parts.length - 1] += b.text;
      else parts.push(b.text);
      joined = true;
    } else if (b.type !== 'thinking' && b.type !== 'redacted_thinking') {
      joined = false;
    }
  }
  return parts.map((p) => p.trim()).filter(Boolean).join('\n\n');
}

export interface WebSource { url: string; title: string }

/** The web pages a reply drew on: the ones it cites, and any page it read in full. */
export function sourcesOf(m: Anthropic.Beta.BetaMessage): WebSource[] {
  const out: WebSource[] = [];
  for (const b of m.content) {
    if (b.type === 'text') {
      for (const c of b.citations ?? []) if (c.type === 'web_search_result_location') out.push({ url: c.url, title: c.title ?? '' });
    } else if (b.type === 'web_fetch_tool_result' && b.content.type === 'web_fetch_result') {
      out.push({ url: b.content.url, title: b.content.content.title ?? '' });
    }
  }
  return out;
}

/**
 * Claude can take a minute or more, and reverse proxies often give up after 60 seconds with a bare 502.
 * Send the 200 right away and a space every few seconds (JSON ignores leading whitespace), then the answer.
 * A failure after that point goes in the body with x-nn-deferred set, and the web app's api() turns it back into an error.
 *
 * With stream set (the browser asked for application/x-ndjson), the body is one JSON object per line instead:
 * {"type":"text","text":"..."} as the reply is written, then {"type":"done",...answer} or {"type":"error",...}.
 * Blank lines keep proxies from timing out.
 */
export async function keepAlive(reply: FastifyReply, work: (onText?: (text: string) => void) => Promise<unknown>, stream = false): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': stream ? 'application/x-ndjson; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no', 'x-nn-deferred': '1',
  });
  const pad = stream ? '\n' : ' ';
  const line = (o: object) => `${JSON.stringify(o)}\n`;
  raw.write(pad);
  const timer = setInterval(() => raw.write(pad), 5000);
  try {
    const onText = stream ? (text: string) => { raw.write(line({ type: 'text', text })); } : undefined;
    const out = await work(onText);
    raw.end(stream ? line({ type: 'done', ...(out as object) }) : JSON.stringify(out));
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('Mixologist:', err);
    const status = err instanceof HttpError ? err.status : 500;
    const error = err instanceof HttpError ? err.message : 'Something went wrong in the kitchen';
    raw.end(stream ? line({ type: 'error', error, status }) : JSON.stringify({ error, status }));
  } finally {
    clearInterval(timer);
  }
}
