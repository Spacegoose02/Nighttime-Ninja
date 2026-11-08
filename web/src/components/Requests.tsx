// The Shopping page's Requests tab: things kids asked for in Den Duty (the family's chore app), waiting for a
// grown-up. Yes puts it on the list picked here (the one used last on this device, or Main); No turns it down.
// Either way the kid sees the answer back in Den Duty.
import { useState } from 'react';
import { api, type ShoppingList } from '../api.ts';
import { lastList, rememberList } from './ListPicker.tsx';
import { useApp, useLoad } from '../state.tsx';
import { t } from '../i18n.ts';

export interface ShoppingRequest {
  id: string; name: string; icon: string; note: string | null; requestedBy: string | null; source: string;
  status: 'waiting' | 'approved' | 'declined'; listName: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string;
}

/** "5 min ago", "3 h ago", "2 days ago". */
function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(`${at.replace(' ', 'T')}Z`)) / 60000));
  if (mins < 1) return t('just now');
  if (mins < 60) return t('{n} min ago', { n: mins });
  if (mins < 60 * 24) return t('{n} h ago', { n: Math.round(mins / 60) });
  return t('{n} days ago', { n: Math.round(mins / 1440) });
}

/** How many requests are waiting, for the tab's badge, and how to count again after answering. */
export function useWaitingRequests(): [number, () => Promise<void>] {
  const { base } = useApp();
  const [waiting, reload] = useLoad<ShoppingRequest[]>(`${base}/shopping/requests`);
  return [waiting?.length ?? 0, reload];
}

export function Requests({ onAnswered }: { onAnswered?: () => void }) {
  const { base, homeId, toast } = useApp();
  const [waiting, reload] = useLoad<ShoppingRequest[]>(`${base}/shopping/requests`);
  const [all, reloadAll] = useLoad<ShoppingRequest[]>(`${base}/shopping/requests?status=all`);
  const [lists] = useLoad<ShoppingList[]>(`${base}/shopping/lists`);
  const main = lists?.find((l) => l.main) ?? lists?.[0];
  const [target, setTarget] = useState<string | null>(() => lastList(homeId));
  const listId = lists?.some((l) => l.id === target) ? target! : main?.id ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const answered = (all ?? []).filter((r) => r.status !== 'waiting');

  const pickList = (id: string) => { setTarget(id); rememberList(homeId, id); };
  async function answer(r: ShoppingRequest, yes: boolean) {
    setBusy(r.id);
    try {
      const done = await api<ShoppingRequest>(`${base}/shopping/requests/${r.id}/${yes ? 'approve' : 'decline'}`, { body: yes ? { listId } : {} });
      toast(yes ? t('{item} is on {list}', { item: r.name, list: done.listName ?? '' }) : t('Said no to {item}', { item: r.name }));
      await Promise.all([reload(), reloadAll()]);
      onAnswered?.();
    } catch (e) {
      toast((e as Error).message);
      await reload();
    } finally { setBusy(null); }
  }

  return (
    <div className="stack requests">
      <p className="muted" style={{ margin: 0 }}>{t('Things the kids asked for in Den Duty. Say yes and it goes on the list you pick.')}</p>
      {lists && lists.length > 1 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="small muted">{t('Yes adds to')}</span>
          <div className="chips" role="radiogroup" aria-label={t('Yes adds to')}>
            {lists.map((l) => (
              <button key={l.id} role="radio" aria-checked={l.id === listId} className={`chip${l.id === listId ? ' on' : ''}`} onClick={() => pickList(l.id)}>{l.name}</button>
            ))}
          </div>
        </div>
      )}
      {waiting && !waiting.length && <div className="card">{t('No requests waiting.')} 🦝</div>}
      {waiting?.map((r) => (
        <div key={r.id} className="card row request" style={{ gap: 12 }}>
          <span className="request-icon" aria-hidden="true">{r.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{r.name}</strong>
            <div className="small muted">{[r.requestedBy && t('{name} asked', { name: r.requestedBy }), ago(r.createdAt)].filter(Boolean).join(' · ')}</div>
            {r.note && <div className="small">{r.note}</div>}
          </div>
          <button disabled={busy === r.id} onClick={() => void answer(r, false)}>{t('No')}</button>
          <button className="primary" disabled={busy === r.id || !listId} onClick={() => void answer(r, true)}>{t('Yes')}</button>
        </div>
      ))}
      {answered.length > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>{t('Answered this week')}</h3>
          {answered.map((r) => (
            <div key={r.id} className="row small" style={{ gap: 8 }}>
              <span aria-hidden="true">{r.icon}</span>
              <span style={{ flex: 1 }}>{r.name}{r.requestedBy ? <span className="muted"> · {r.requestedBy}</span> : null}</span>
              <span className={`pill${r.status === 'approved' ? ' ok' : ''}`}>{r.status === 'approved' ? t('Yes, on {list}', { list: r.listName ?? '' }) : t('No')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
