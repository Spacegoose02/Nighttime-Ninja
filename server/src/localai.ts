// Your own AI server instead of Claude: Ollama, LM Studio, llama.cpp, vLLM, LocalAI or any other server with an
// OpenAI-compatible /chat/completions endpoint. Set AI_BASE_URL (and AI_MODEL) and every AI feature uses it.
//
// The rest of the app speaks Claude's message format, so this file translates a request into the OpenAI shape and the
// answer back. Text, images, tools and JSON answers carry over. Claude's own web search doesn't: a local model
// answers from what it knows and what's in the kitchen.
import type Anthropic from '@anthropic-ai/sdk';
import { HttpError } from './util.ts';

export interface LocalAi { baseUrl: string; model: string; apiKey: string | null }

type Params = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model' | 'max_tokens'>;
type Block = { type: string; [k: string]: unknown };
type OaPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type OaToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type OaMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OaPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OaToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const blocks = (content: unknown): Block[] => (typeof content === 'string' ? [{ type: 'text', text: content }] : (content as Block[]) ?? []);

function plain(content: unknown): string {
  if (typeof content === 'string') return content;
  return blocks(content).filter((b) => b.type === 'text').map((b) => String(b.text)).join('\n');
}

/** Claude's request (system, messages, tools, JSON schema) as an OpenAI chat completions request. */
export function toOpenAi(params: Params, model: string): Record<string, unknown> {
  const messages: OaMessage[] = [];
  const system = plain(params.system);
  if (system) messages.push({ role: 'system', content: system });

  for (const m of params.messages) {
    if (m.role === 'assistant') {
      const text = blocks(m.content).filter((b) => b.type === 'text').map((b) => String(b.text)).join('');
      const calls = blocks(m.content).filter((b) => b.type === 'tool_use')
        .map((b): OaToolCall => ({ id: String(b.id), type: 'function', function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    const parts: OaPart[] = [];
    for (const b of blocks(m.content)) {
      if (b.type === 'tool_result') {
        messages.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: (b.is_error ? 'Error: ' : '') + plain(b.content) });
      } else if (b.type === 'text') {
        parts.push({ type: 'text', text: String(b.text) });
      } else if (b.type === 'image') {
        const src = b.source as { type: string; media_type?: string; data?: string; url?: string };
        const url = src.type === 'base64' ? `data:${src.media_type};base64,${src.data}` : src.url;
        if (url) parts.push({ type: 'image_url', image_url: { url } });
      } else if (b.type === 'document') {
        const src = b.source as { type: string; data?: string };
        if (src.type === 'text' && src.data) parts.push({ type: 'text', text: src.data });
        else throw new HttpError(422, "Your own AI server can't read PDFs. Upload a photo instead, or use Claude for this.");
      }
    }
    if (parts.length) messages.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => (p as { text: string }).text).join('\n') : parts });
  }

  // Only the app's own tools carry over. Claude's server tools (web search and fetch) have no local equivalent.
  const tools = ((params.tools ?? []) as Block[])
    .filter((t) => (!t.type || t.type === 'custom') && t.input_schema)
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } }));
  const choice = params.tool_choice as { type: string; name?: string } | undefined;
  const format = (params.output_config as { format?: { type: string; schema?: unknown } } | undefined)?.format;

  return {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 8000,
    ...(tools.length ? { tools } : {}),
    ...(tools.length && choice?.type === 'tool' ? { tool_choice: { type: 'function', function: { name: choice.name } } } : {}),
    ...(format?.type === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: format.schema } } } : {}),
  };
}

/** Reads an OpenAI-style server-sent event stream into Claude's message shape. */
export async function fromOpenAiStream(body: ReadableStream<Uint8Array>, onText?: (text: string) => void): Promise<Anthropic.Beta.BetaMessage> {
  let text = '';
  let finish: string | null = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  const calls: { id: string; name: string; args: string }[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line: string) => {
    const data = line.replace(/^data:\s*/, '').trim();
    if (!line.startsWith('data:') || !data || data === '[DONE]') return;
    let chunk: { usage?: { prompt_tokens?: number; completion_tokens?: number } | null; choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] };
    try { chunk = JSON.parse(data); } catch { return; }
    if (chunk.usage) usage = { input_tokens: chunk.usage.prompt_tokens ?? 0, output_tokens: chunk.usage.completion_tokens ?? 0 };
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const piece = choice.delta?.content;
    if (piece) { text += piece; onText?.(piece); }
    for (const c of choice.delta?.tool_calls ?? []) {
      const i = c.index ?? calls.length;
      calls[i] ??= { id: '', name: '', args: '' };
      if (c.id) calls[i].id = c.id;
      if (c.function?.name) calls[i].name += c.function.name;
      if (c.function?.arguments) calls[i].args += c.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  };
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handle);
  }
  if (buffer) handle(buffer);

  const content: Block[] = [];
  if (text) content.push({ type: 'text', text, citations: null });
  calls.filter((c) => c.name).forEach((c, i) => {
    let input: unknown = {};
    try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = {}; }
    content.push({ type: 'tool_use', id: c.id || `call_${i}`, name: c.name, input });
  });
  const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn';
  return { id: 'local', type: 'message', role: 'assistant', model: 'local', content, stop_reason: stop, stop_sequence: null, usage } as unknown as Anthropic.Beta.BetaMessage;
}

/** Asks your own AI server. Same inputs and output as asking Claude. */
export async function askLocal(local: LocalAi, params: Params, onText?: (text: string) => void): Promise<Anthropic.Beta.BetaMessage> {
  const url = `${local.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(local.apiKey ? { authorization: `Bearer ${local.apiKey}` } : {}) },
      body: JSON.stringify(toOpenAi(params, local.model)),
      signal: AbortSignal.timeout(10 * 60e3),
    });
  } catch (err) {
    console.error('Local AI: request failed', (err as Error).message);
    throw new HttpError(502, `Couldn't reach your AI server at ${local.baseUrl}. Is it running, and can the Nighttime Ninja server reach it?`);
  }
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 404) throw new HttpError(502, `Your AI server doesn't know the model "${local.model}". Check AI_MODEL (for Ollama: ollama pull ${local.model}). ${detail}`);
    throw new HttpError(502, `Your AI server answered ${res.status}: ${detail}`);
  }
  return fromOpenAiStream(res.body, onText);
}
