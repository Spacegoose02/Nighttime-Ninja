// The AI chat screen shared by the Mixologist (Rocco) and the Chef (Gordy): streaming replies, past chats, and
// the small Markdown renderer for what they write back.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDialogs } from './Dialog.tsx';
import { api, apiStream } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

/* ---------- a tiny, safe Markdown renderer for chat replies ---------- */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (heading) blocks.push(<h3 key={blocks.length} style={{ margin: '8px 0 4px' }}>{inline(heading[1].replace(/\*\*/g, ''))}</h3>);
    else if (/^-{3,}$/.test(line.trim())) blocks.push(<hr key={blocks.length} />);
    else if (line.trim()) blocks.push(<p key={blocks.length} style={{ margin: '4px 0' }}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

/* ---------- the chat itself ---------- */

interface ChatAction { type: 'shopping' | 'saved'; label: string; recipeId?: string }
interface ChatMsg { role: 'user' | 'assistant'; content: string; actions?: ChatAction[] }

export interface ChatPersona {
  /** API path under the home, e.g. "mixologist/chat". */
  endpoint: string;
  name: string;
  /** Picture for the chat bubbles; falls back to the emoji if the file isn't there. */
  avatar: string;
  emoji: string;
  intro: string;
  starters: string[];
  placeholder: string;
  thinking: string;
}

/** A round picture for chat bubbles, or the persona's emoji until the image exists. */
export function ChatAvatar({ p, size = 40 }: { p: ChatPersona; size?: number }) {
  const [broken, setBroken] = useState(false);
  return broken
    ? <span className="chat-avatar" style={{ width: size, height: size, fontSize: size * 0.55 }} role="img" aria-label={p.name}>{p.emoji}</span>
    : <img className="chat-avatar" src={p.avatar} alt={p.name} width={size} height={size} onError={() => setBroken(true)} />;
}

interface PastChat { id: string; title: string; archived: boolean; updatedAt: string; messages: number; saved: string[] }

/** Past chats with this persona: reopen one, archive it, or delete it. */
function PastChats({ kind, current, onOpen, onClose }: { kind: string; current: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const { base, toast } = useApp();
  const dialogs = useDialogs();
  const [showArchived, setShowArchived] = useState(true);
  const [list, reload] = useLoad<PastChat[]>(`${base}/ai-chats?kind=${kind}`);
  const shown = (list ?? []).filter((c) => showArchived || !c.archived);
  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>📚 Past chats</h2>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: 20, minHeight: 20 }} /> Show archived
        </label>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
      {list && !shown.length && <p className="muted" style={{ margin: 0 }}>No past chats yet. Every chat is kept here, and “New chat” archives the one you're in.</p>}
      <div className="list">
        {shown.map((c) => (
          <div key={c.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{c.title}{c.id === current && <span className="pill ok" style={{ marginLeft: 6 }}>open</span>}{c.archived && <span className="pill" style={{ marginLeft: 6 }}>archived</span>}</div>
              <div className="small muted">{new Date(`${c.updatedAt.replace(' ', 'T')}Z`).toLocaleString()} · {c.messages} messages</div>
              {!!c.saved.length && <div className="small">📖 {c.saved.join(', ')}</div>}
            </div>
            <button onClick={() => onOpen(c.id)}>Open</button>
            <button className="ghost" onClick={async () => { await api(`${base}/ai-chats/${c.id}`, { method: 'PATCH', body: { archived: !c.archived } }); await reload(); }}>{c.archived ? 'Unarchive' : 'Archive'}</button>
            <button className="ghost danger" onClick={async () => { if (!(await dialogs.confirm('Delete this chat for good? Recipes you saved from it stay in your recipe book.', { okLabel: 'Delete', danger: true }))) return; await api(`${base}/ai-chats/${c.id}`, { method: 'DELETE' }); toast('Deleted'); await reload(); }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Chat({ disabled, persona }: { disabled: boolean; persona: ChatPersona }) {
  const { base, homeId, toast } = useApp();
  const kind = persona.endpoint.split('/')[0];
  const key = `nn-chat-${kind}-${homeId}`;
  const [chatId, setChatId] = useState<string | null>(() => { try { return localStorage.getItem(key); } catch { return null; } });
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** The reply so far while it's being written. */
  const [streaming, setStreaming] = useState('');
  /** The last finished reply, read out by screen readers (the streaming bubble itself stays quiet). */
  const [announce, setAnnounce] = useState('');
  const [showPast, setShowPast] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  // Chats live on the server, so they survive closing the app and show up on every device.
  useEffect(() => {
    try { if (chatId) localStorage.setItem(key, chatId); else localStorage.removeItem(key); } catch { /* private mode */ }
  }, [chatId, key]);

  useEffect(() => {
    if (!chatId) return;
    api<{ messages: ChatMsg[] }>(`${base}/ai-chats/${chatId}`).then((c) => setMsgs(c.messages), () => setChatId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    end.current?.scrollIntoView({ behavior: calm || streaming ? 'auto' : 'smooth', block: 'end' });
  }, [msgs, streaming]);

  async function open(id: string) {
    const c = await api<{ id: string; messages: ChatMsg[] }>(`${base}/ai-chats/${id}`);
    setChatId(c.id);
    setMsgs(c.messages);
    setShowPast(false);
  }

  async function newChat() {
    if (chatId) await api(`${base}/ai-chats/${chatId}`, { method: 'PATCH', body: { archived: true } }).catch(() => {});
    setChatId(null);
    setMsgs([]);
    if (chatId) toast('Archived. Find it under Past chats.');
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...msgs, { role: 'user' as const, content }];
    setMsgs(next);
    setDraft('');
    setBusy(true);
    let preview = '';
    try {
      // Send what the app did after each reply too, so the chef knows what's already saved.
      const res = await apiStream<{ reply: string; actions: ChatAction[]; chatId: string }>(
        `${base}/${persona.endpoint}`,
        { chatId, messages: next.map(({ role, content: c, actions }) => ({ role, content: c, actions })) },
        (text) => { preview += text; setStreaming(preview); },
      );
      setChatId(res.chatId);
      setMsgs([...next, { role: 'assistant', content: res.reply, actions: res.actions }]);
      setAnnounce(`${persona.name}: ${res.reply.replace(/[*_#`>]/g, '')}`);
    } catch (e) {
      toast((e as Error).message);
      setMsgs(msgs);
      setDraft(content);
    } finally {
      setBusy(false);
      setStreaming('');
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <span className="spacer" />
        <button className="ghost" onClick={() => setShowPast(!showPast)}>📚 Past chats</button>
        {!!msgs.length && <button className="ghost" onClick={newChat} disabled={busy}>＋ New chat</button>}
      </div>
      {showPast && <PastChats kind={kind} current={chatId} onOpen={open} onClose={() => setShowPast(false)} />}
      <div className="card stack chat-log">
        {!msgs.length && (
          <div className="stack">
            <div className="chat-row">
              <ChatAvatar p={persona} size={56} />
              <div className="bubble assistant">{persona.intro}</div>
            </div>
            <div className="chips">{persona.starters.map((s) => <button key={s} className="chip" disabled={disabled || busy} onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-row ${m.role}`}>
          {m.role === 'assistant' && <ChatAvatar p={persona} />}
          <div className={`bubble ${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
            {!!m.actions?.length && (
              <div className="chips" style={{ marginTop: 8 }}>
                {m.actions.map((a, j) => a.recipeId
                  ? <Link key={j} className="pill ok" to={`/recipes/${a.recipeId}`}>📖 {a.label}</Link>
                  : <Link key={j} className="pill ok" to="/shopping">🛒 {a.label}</Link>)}
              </div>
            )}
          </div>
          </div>
        ))}
        {busy && (
          <div className="chat-row">
            <ChatAvatar p={persona} />
            {streaming
              ? <div className="bubble assistant"><Markdown text={streaming} /></div>
              : <div className="bubble assistant muted">{persona.thinking}</div>}
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="sr-only" role="status" aria-live="polite">{busy ? persona.thinking : announce}</div>
      <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <textarea
          value={draft} onChange={(e) => setDraft(e.target.value)} disabled={disabled} rows={2}
          placeholder={persona.placeholder} style={{ flex: 1, minHeight: 56 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
        />
        <button className="primary" disabled={disabled || busy || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}

