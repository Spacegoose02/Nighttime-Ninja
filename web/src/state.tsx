import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Me } from './api.ts';

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

/** Small data-loading hook: returns [data, reload, error]. */
export function useLoad<T>(path: string | null, deps: unknown[] = []): [T | null, () => Promise<void>, string | null] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { void load(); }, [load]);
  return [data, load, error];
}
