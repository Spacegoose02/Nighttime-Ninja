import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, CLIENT_ID, type Me } from './api.ts';
import { flushOutbox } from './offline.ts';

interface AppState {
  me: Me | null;
  loading: boolean;
  homeId: string | null;
  home: Me['homes'][number] | null;
  refresh: () => Promise<void>;
  setHome: (id: string) => void;
  toast: (msg: string) => void;
  /** Prefix for the current home's API routes. */
  base: string;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('/api/me');
      setMe(m);
      setHomeId((cur) => {
        const ids = m.homes.map((h) => h.id);
        if (cur && ids.includes(cur)) return cur;
        if (m.user.lastHomeId && ids.includes(m.user.lastHomeId)) return m.user.lastHomeId;
        return ids[0] ?? null;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = me?.user.theme ?? 'forest';
  }, [me?.user.theme]);

  const setHome = useCallback((id: string) => {
    setHomeId(id);
    void api('/api/me', { method: 'PATCH', body: { lastHomeId: id } });
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3200);
  }, []);

  // Send changes made with no signal as soon as the connection is back (and at start, in case the app was closed).
  useEffect(() => {
    if (!me) return;
    const sync = async () => {
      const sent = await flushOutbox();
      if (sent) {
        revalidate('/api/');
        toast(`Back online: synced ${sent} change${sent === 1 ? '' : 's'}`);
      }
    };
    void sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [me, toast]);

  // Live updates: when someone else in the home changes something, refresh whatever is on screen.
  useEffect(() => {
    if (!homeId || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/homes/${homeId}/events`);
    let dropped = false;
    es.onmessage = (e) => {
      const change = JSON.parse(e.data) as { area: string; by: string | null };
      if (change.by === CLIENT_ID) return;
      revalidate(`/api/homes/${homeId}`);
      if (change.area === 'home' || change.area === 'members') void refresh();
    };
    es.onerror = () => { dropped = true; };
    // Back after a dropped connection: anything could have changed meanwhile.
    es.onopen = () => { if (dropped) revalidate(`/api/homes/${homeId}`); dropped = false; };
    return () => es.close();
  }, [homeId, refresh]);

  const home = me?.homes.find((h) => h.id === homeId) ?? null;
  return (
    <Ctx.Provider value={{ me, loading, homeId, home, refresh, setHome, toast, base: `/api/homes/${homeId}` }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

// ---------- data loading ----------

/** Last answer for each path, so a tab you've already opened shows straight away while it refreshes. */
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
/** Reloaders of every useLoad on screen, by path, so live updates can refresh exactly what's showing. */
const mounted = new Map<string, Set<() => Promise<void>>>();

/** Refreshes every useLoad on screen whose path starts with prefix. */
export function revalidate(prefix: string): void {
  for (const [path, fns] of mounted) if (path.startsWith(prefix)) for (const fn of fns) void fn();
}

/**
 * Small data-loading hook: returns [data, reload, error, mutate].
 * Shows the last answer for the path at once (stale-while-revalidate), then the fresh one. Screens opening the same
 * path at the same time share one request. mutate changes the data on screen right away, for optimistic updates.
 */
export function useLoad<T>(path: string | null, deps: unknown[] = []): [T | null, () => Promise<void>, string | null, (update: (cur: T | null) => T | null) => void] {
  const [data, setData] = useState<T | null>(() => (path && cache.has(path) ? cache.get(path) as T : null));
  const [error, setError] = useState<string | null>(null);
  const fetchFresh = useCallback(async (share: boolean) => {
    if (!path) return;
    if (cache.has(path)) setData(cache.get(path) as T);
    try {
      let p = share ? inflight.get(path) : undefined;
      if (!p) {
        p = api<T>(path).finally(() => { if (inflight.get(path) === p) inflight.delete(path); });
        inflight.set(path, p);
      }
      const fresh = await p as T;
      cache.set(path, fresh);
      setData(fresh);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  // An explicit reload (after a change) always asks the server again rather than joining an older request.
  const load = useCallback(() => fetchFresh(false), [fetchFresh]);
  useEffect(() => {
    void fetchFresh(true);
    if (!path) return;
    const set = mounted.get(path) ?? new Set<() => Promise<void>>();
    mounted.set(path, set);
    set.add(load);
    return () => { set.delete(load); if (!set.size) mounted.delete(path); };
  }, [fetchFresh, load, path]);
  const mutate = useCallback((update: (cur: T | null) => T | null) => {
    setData((cur) => {
      const next = update(cur);
      if (path) cache.set(path, next);
      return next;
    });
  }, [path]);
  return [data, load, error, mutate];
}
