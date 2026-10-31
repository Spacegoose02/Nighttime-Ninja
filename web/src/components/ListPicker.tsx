// Which shopping list something goes on, for the "add to list" buttons around the app (pantry, recipes, meal plan,
// Chef, Mixologist). With one list there's nothing to ask. With more, a small pop-up offers them all, with the one
// used last (or Main, for the weekly shop) ready to tap.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Dialog.tsx';
import type { ShoppingList } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

/** Where an add went: the list's id (undefined when the home has only Main) and how to say it in a message. */
export interface ListChoice { id: string | undefined; label: string }

const lastKey = (homeId: string | null) => `nn-last-list-${homeId}`;

/** The list this device used last in this home, if any. */
export function lastList(homeId: string | null): string | null {
  try { return localStorage.getItem(lastKey(homeId)); } catch { return null; }
}

export function rememberList(homeId: string | null, id: string): void {
  try { localStorage.setItem(lastKey(homeId), id); } catch { /* private mode */ }
}

/**
 * Returns pick(), which resolves to the chosen list (or null if the person backed out), and the pop-up to render.
 * prefer: 'last' starts on the list used last on this device; 'main' starts on Main.
 */
export function useListPicker(): { pick: (opts?: { prefer?: 'last' | 'main'; title?: string }) => Promise<ListChoice | null>; picker: ReactNode } {
  const { base, homeId } = useApp();
  const [lists] = useLoad<ShoppingList[]>(`${base}/shopping/lists`);
  const [asking, setAsking] = useState<{ preset: string; title: string } | null>(null);
  const resolver = useRef<((c: ListChoice | null) => void) | null>(null);

  const pick = useCallback((opts?: { prefer?: 'last' | 'main'; title?: string }) => {
    if (!lists || lists.length < 2) return Promise.resolve<ListChoice>({ id: lists?.[0]?.id, label: 'the shopping list' });
    const main = lists.find((l) => l.main) ?? lists[0];
    const last = lastList(homeId);
    const preset = opts?.prefer !== 'main' && last && lists.some((l) => l.id === last) ? last : main.id;
    return new Promise<ListChoice | null>((resolve) => {
      resolver.current = resolve;
      setAsking({ preset, title: opts?.title ?? 'Add to which list?' });
    });
  }, [lists, homeId]);

  const done = (l: ShoppingList | null) => {
    setAsking(null);
    if (l) rememberList(homeId, l.id);
    resolver.current?.(l ? { id: l.id, label: l.name } : null);
    resolver.current = null;
  };

  const picker = asking && lists ? (
    <Modal label={asking.title} onClose={() => done(null)}>
      <h2>{asking.title}</h2>
      <div className="stack">
        {lists.map((l) => (
          <button key={l.id} className={l.id === asking.preset ? 'primary' : ''} autoFocus={l.id === asking.preset} onClick={() => done(l)}>
            🛒 {l.name}{l.open ? <span className="small" style={{ opacity: 0.75 }}> · {l.open} to buy</span> : null}
          </button>
        ))}
      </div>
      <div className="row"><span className="spacer" /><button onClick={() => done(null)}>Cancel</button></div>
    </Modal>
  ) : null;

  return { pick, picker };
}
