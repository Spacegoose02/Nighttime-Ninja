// Shared plumbing for the AI chats (Rocco Rocks the Mixologist, Chef Gordy): the tool loop, honest saving,
// and chats kept on the server so old ones can be archived and reopened.
import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, str } from '../util.ts';
import { ask, claude, keepAlive, textOf } from './mixologist.ts';

export type ChatKind = 'mixologist' | 'chef';
export interface ChatAction { type: 'shopping' | 'saved'; label: string; recipeId?: string }
export interface StoredMsg { role: 'user' | 'assistant'; content: string; actions?: ChatAction[] }

/** Rules both chats follow so a "saved" in the reply always means it really is in the recipe book. */
export const TOOL_RULES = `
## Saving and the shopping list (important)
- Only say something is saved, kept, or added after the tool for it has run in this reply and succeeded. Never claim it otherwise.
- When asked to save, call the save tool with the full recipe. Then reply with one short line confirming it. Do not write the recipe out again.
- Earlier replies note what the app already did, like "(Done in the app: Saved Biscuits)". Don't save the same recipe again unless asked. Saving a recipe with the same title updates it rather than making a copy, so keep the title the same when saving changes.
- Don't repeat a recipe you already gave unless the person asks for changes.`;

const SAVE_INTENT = /\b(save|saving|keep|store|remember|bookmark)\b|\badd (it|this|that|them) to (my |the )?(recipes?|recipe book|book|drinks)\b/i;
const NOT_SAVE = /\b(shopping|grocery|list)\b|\bdon'?t save\b|\bno need to save\b/i;
const CLAIMS_SAVE = /\b(i'?ve saved|i have saved|saved (it|this|that|them|your)|it'?s saved|is now saved|added (it|this|that) to your (recipes?|recipe book|drinks))\b/i;

function cleanActions(v: unknown): ChatAction[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).flatMap((a: Row) => (a && (a.type === 'shopping' || a.type === 'saved') && typeof a.label === 'string'
    ? [{ type: a.type, label: a.label.slice(0, 200), ...(typeof a.recipeId === 'string' ? { recipeId: a.recipeId.slice(0, 60) } : {}) } as ChatAction]
    : []));
}

/** The conversation as the browser sent it, keeping what the app did after each reply. */
export const wantsToSave = (text: string): boolean => SAVE_INTENT.test(text) && !NOT_SAVE.test(text);

export function readHistory(b: Row): StoredMsg[] {
  const msgs = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m: Row) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-40)
    .map((m: Row): StoredMsg => ({ role: m.role as StoredMsg['role'], content: String(m.content).slice(0, 12000), actions: cleanActions(m.actions) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

/** For Claude: tell it what each earlier reply actually did, so it doesn't save twice or claim saves that never happened. */
function toClaude(msgs: StoredMsg[]): Anthropic.Beta.BetaMessageParam[] {
  return msgs.slice(-30).map((m) => ({
    role: m.role,
    content: m.role === 'assistant' && m.actions?.length ? `${m.content}\n\n(Done in the app: ${m.actions.map((a) => a.label).join('; ')})` : m.content,
  }));
}

export interface ChatTurn {
  kind: ChatKind;
  system: Anthropic.Beta.BetaTextBlockParam[];
  tools: Anthropic.Beta.BetaTool[];
  saveTool: string;
  refused: string;
  empty: string;
  runTool: (name: string, input: Row, actions: ChatAction[]) => string;
}

function saveChat(db: DatabaseSync, ctx: HomeCtx, kind: ChatKind, chatId: string | null, msgs: StoredMsg[]): string {
  const userId = ctx.user?.id ?? null;
  const title = (msgs.find((m) => m.role === 'user')?.content ?? 'Chat').replace(/\s+/g, ' ').slice(0, 80);
  const existing = chatId ? db.prepare('SELECT id FROM ai_chats WHERE id = ? AND home_id = ? AND user_id IS ?').get(chatId, ctx.homeId, userId) as Row | undefined : undefined;
  if (existing) {
    db.prepare("UPDATE ai_chats SET messages = ?, archived = 0, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(msgs), chatId!);
    return chatId!;
  }
  const id = newId();
  db.prepare('INSERT INTO ai_chats (id, home_id, user_id, kind, title, messages) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, ctx.homeId, userId, kind, title, JSON.stringify(msgs));
  return id;
}

/** One chat turn: runs the tool loop, makes sure saves are real, and stores the chat. */
export async function runChat(db: DatabaseSync, req: FastifyRequest, reply: FastifyReply, turn: ChatTurn): Promise<void> {
  const ctx = homeCtx(db, req);
  const b = (req.body ?? {}) as Row;
  const history = readHistory(b);
  if (!history.length || history[history.length - 1].role !== 'user') throw new HttpError(400, 'Say something first');
  claude(db);
  const chatId = str(b.chatId, 60);
  const lastUser = history[history.length - 1].content;
  const wantsSave = wantsToSave(lastUser);

  await keepAlive(reply, async () => {
    const { reply: replyText, actions } = await chatLoop((p) => ask(db, p), turn, history, wantsSave);
    const stored = [...history, { role: 'assistant' as const, content: replyText, actions }];
    const id = saveChat(db, ctx, turn.kind, chatId, stored);
    return { reply: replyText, actions, chatId: id };
  });
}

type AskFn = (p: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model' | 'max_tokens'>) => Promise<Anthropic.Beta.BetaMessage>;

/** The tool loop on its own (no HTTP), so it can be tested with a stand-in for Claude. */
export async function chatLoop(askFn: AskFn, turn: Pick<ChatTurn, 'system' | 'tools' | 'saveTool' | 'refused' | 'empty' | 'runTool'>, history: StoredMsg[], wantsSave: boolean): Promise<{ reply: string; actions: ChatAction[] }> {
  const messages = toClaude(history);
  const actions: ChatAction[] = [];
  let finalText = '';
  const earlier: string[] = [];
  const round = (force: string | null) => askFn({
    system: turn.system, tools: turn.tools, messages,
    ...(force ? { tool_choice: { type: 'tool' as const, name: force } } : {}),
    output_config: { effort: 'low' },
  });

  // If they asked to save, make sure the save tool actually runs instead of trusting the model to remember.
  let force: string | null = wantsSave ? turn.saveTool : null;
  let refused = false;
  for (let i = 0; i < 6; i++) {
    const res = await round(force);
    force = null;
    if (res.stop_reason === 'refusal') { refused = true; break; }
    const text = textOf(res);
    if (res.stop_reason !== 'tool_use') { finalText = text; break; }
    if (text) earlier.push(text);
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      try {
        results.push({ type: 'tool_result', tool_use_id: block.id, content: turn.runTool(block.name, block.input as Row, actions) });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Failed: ${(err as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  // It says it saved but no save ran: make it save for real, once.
  if (!refused && !actions.some((a) => a.type === 'saved') && CLAIMS_SAVE.test(finalText)) {
    messages.push({ role: 'assistant', content: finalText || '.' });
    messages.push({ role: 'user', content: 'You said it was saved, but nothing was saved yet. Save it now with the tool.' });
    try {
      const res = await round(turn.saveTool);
      for (const block of res.content) {
        if (block.type === 'tool_use') {
          try { turn.runTool(block.name, block.input as Row, actions); } catch { /* reported below */ }
        }
      }
    } catch { /* reported below */ }
    if (!actions.some((a) => a.type === 'saved')) finalText += "\n\n(Heads up: that didn't actually save. Ask me to save it again.)";
  }

  // After a save, the closing line is enough; don't repeat a recipe the person already has on screen.
  let replyText = refused ? turn.refused : finalText;
  if (!refused && !actions.some((a) => a.type === 'saved') && earlier.length) {
    replyText = [...new Set([...earlier, finalText].filter(Boolean))].join('\n\n');
  }
  if (!replyText.trim()) replyText = actions.length ? actions.map((a) => a.label).join('. ') + '.' : turn.empty;
  return { reply: replyText, actions };
}

export function chatHistoryRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Your own chats with Rocco or Gordy, newest first. Archived ones are kept until you delete them.
  app.get('/api/homes/:homeId/ai-chats', async (req) => {
    const ctx = homeCtx(db, req);
    const q = req.query as Row;
    const kind = q.kind === 'chef' ? 'chef' : 'mixologist';
    const rows = db.prepare(`SELECT id, title, archived, created_at, updated_at, messages FROM ai_chats
      WHERE home_id = ? AND user_id IS ? AND kind = ? ORDER BY updated_at DESC LIMIT 200`).all(ctx.homeId, ctx.user?.id ?? null, kind) as Row[];
    return rows.map((r) => {
      const msgs = JSON.parse(r.messages as string) as StoredMsg[];
      return {
        id: r.id, title: r.title, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
        messages: msgs.length, saved: msgs.flatMap((m) => (m.actions ?? []).filter((a) => a.type === 'saved').map((a) => a.label.replace(/^Saved /, ''))),
      };
    });
  });

  app.get('/api/homes/:homeId/ai-chats/:id', async (req) => {
    const ctx = homeCtx(db, req);
    const r = db.prepare('SELECT * FROM ai_chats WHERE id = ? AND home_id = ? AND user_id IS ?').get((req.params as { id: string }).id, ctx.homeId, ctx.user?.id ?? null) as Row | undefined;
    if (!r) throw new HttpError(404, 'Chat not found');
    return { id: r.id, kind: r.kind, title: r.title, archived: !!r.archived, messages: JSON.parse(r.messages as string) };
  });

  app.patch('/api/homes/:homeId/ai-chats/:id', async (req) => {
    const ctx = homeCtx(db, req);
    const b = (req.body ?? {}) as Row;
    const id = (req.params as { id: string }).id;
    if (typeof b.archived === 'boolean') db.prepare('UPDATE ai_chats SET archived = ? WHERE id = ? AND home_id = ? AND user_id IS ?').run(b.archived ? 1 : 0, id, ctx.homeId, ctx.user?.id ?? null);
    const title = str(b.title, 80);
    if (title) db.prepare('UPDATE ai_chats SET title = ? WHERE id = ? AND home_id = ? AND user_id IS ?').run(title, id, ctx.homeId, ctx.user?.id ?? null);
    return { ok: true };
  });

  app.delete('/api/homes/:homeId/ai-chats/:id', async (req) => {
    const ctx = homeCtx(db, req);
    db.prepare('DELETE FROM ai_chats WHERE id = ? AND home_id = ? AND user_id IS ?').run((req.params as { id: string }).id, ctx.homeId, ctx.user?.id ?? null);
    return { ok: true };
  });
}

/** A recipe with this title already in the home, so a repeat save updates it instead of adding a copy. */
export function existingRecipeId(db: DatabaseSync, homeId: string, title: string): string | undefined {
  const row = db.prepare('SELECT id FROM recipes WHERE home_id = ? AND title = ? COLLATE NOCASE ORDER BY updated_at DESC').get(homeId, title.trim()) as Row | undefined;
  return (row?.id as string | undefined) ?? undefined;
}
