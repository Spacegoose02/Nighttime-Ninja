// One search box for the whole app (Ctrl+K, or the search button): pages, recipes, pantry items and settings,
// plus quick actions such as "add milk to the list" or "ask Gordy".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Item, type RecipeSummary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { guessItem } from '../../../shared/catalog.ts';
import { Modal } from './Dialog.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { t } from '../i18n.ts';

export interface Command { id: string; label: string; hint?: string; icon?: IconName; emoji?: string; run: () => void | Promise<void> }

const SETTINGS: [string, string][] = [
  ['Theme and avatar', 'you'], ['Measurements (US or metric)', 'you'], ['Reminders', 'you'], ['Password, two-factor and passkeys', 'you'],
  ['Pair a tablet or phone', 'you'], ['Invite people to the home', 'home'], ['Stores', 'home'], ['Google Calendar', 'home'],
  ['Diets and allergies', 'home'], ['Pantry places and categories', 'home'], ['Kitchen tools', 'kitchen'], ['Download everything', 'home'],
  ['Backups', 'server'], ['Claude model and web search', 'server'], ['People on this server', 'server'],
];

/** Scores how well text matches: whole-word starts beat matches in the middle. 0 = no match. */
export function matchScore(text: string, q: string): number {
  const t = text.toLowerCase();
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let score = 0;
  for (const w of words) {
    const at = t.indexOf(w);
    if (at < 0) return 0;
    score += at === 0 ? 3 : /\W/.test(t[at - 1]) ? 2 : 1;
  }
  return score;
}

export function CommandBar({ pages, onClose }: { pages: { to: string; label: string; ico: IconName }[]; onClose: () => void }) {
  const { base, toast } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const [recipes] = useLoad<RecipeSummary[]>(`${base}/recipes`);
  const [items] = useLoad<Item[]>(`${base}/items`);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const go = (to: string) => () => { onClose(); nav(to); };
  const results = useMemo<Command[]>(() => {
    const text = q.trim();
    const all: (Command & { score: number })[] = [];
    for (const p of pages) all.push({ id: `p${p.to}`, label: t(p.label), hint: t('Page'), icon: p.ico, run: go(p.to), score: matchScore(t(p.label), text) && matchScore(t(p.label), text) + 1 });
    for (const r of recipes ?? []) all.push({ id: `r${r.id}`, label: r.title, hint: t('Recipe'), icon: 'recipes', run: go(`/recipes/${r.id}`), score: Math.max(matchScore(r.title, text), matchScore(r.tags.join(' '), text) - 1) });
    for (const i of items ?? []) all.push({ id: `i${i.id}`, label: i.name, hint: `${t('Pantry')} · ${i.location}`, emoji: i.icon ?? guessItem(i.name).icon, run: go(`/inventory?q=${encodeURIComponent(i.name)}`), score: matchScore(i.name, text) });
    for (const [label, section] of SETTINGS) all.push({ id: `s${label}`, label: t(label), hint: t('Settings'), icon: 'settings', run: go(`/settings?section=${section}`), score: matchScore(t(label), text) });
    const found = text ? all.filter((c) => c.score > 0).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 12) : all.filter((c) => c.hint === t('Page'));
    if (!text) return found;
    const actions: Command[] = [
      {
        id: 'add', label: t('Add “{text}” to the shopping list', { text }), icon: 'shopping', run: async () => {
          onClose();
          try { await api(`${base}/shopping`, { body: { text } }); toast(t('Added {item} to the list', { item: text })); } catch (e) { toast((e as Error).message); }
        },
      },
      { id: 'gordy', label: t('Ask Gordy: “{text}”', { text }), icon: 'chef', run: go(`/chef?ask=${encodeURIComponent(text)}`) },
    ];
    return [...found, ...actions];
  // biome-ignore lint/correctness/useExhaustiveDependencies: go and onClose are stable enough for one open dialog.
  }, [q, recipes, items, pages, base]);
  useEffect(() => setAt(0), [q]);

  return (
    <Modal label={t('Search')} className="command-bar" onClose={onClose}>
      <input
        ref={input} type="search" value={q} placeholder={t('Search recipes, pantry, settings… or type something to add')}
        aria-label={t('Search everything')} aria-controls="command-results" aria-activedescendant={results[at] ? `cmd-${at}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(results.length - 1, n + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(0, n - 1)); }
          if (e.key === 'Enter' && results[at]) { e.preventDefault(); void results[at].run(); }
        }}
      />
      <div id="command-results" className="command-results" role="listbox" aria-label={t('Results')}>
        {results.map((c, n) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the search box above handles the arrow keys and Enter for the list.
          <div
            key={c.id} id={`cmd-${n}`} role="option" aria-selected={n === at} tabIndex={-1}
            className={`command-item${n === at ? ' on' : ''}`} onClick={() => void c.run()} onMouseEnter={() => setAt(n)}
          >
            {c.icon ? <Icon name={c.icon} /> : <span aria-hidden>{c.emoji}</span>}
            <span className="command-label">{c.label}</span>
            {c.hint && <span className="small muted">{c.hint}</span>}
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('Tip: press Ctrl+K (or ⌘K) anywhere to open this.')}</p>
    </Modal>
  );
}
