// Changes made with no signal (checking things off in the store) wait here and are sent once the device is back
// online. Kept in localStorage so they survive the app being closed in the meantime.
import { api, ApiError } from './api.ts';

interface Pending { path: string; method: string; body: unknown }

const KEY = 'nn-outbox';

function read(): Pending[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[]; } catch { return []; }
}

function write(list: Pending[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode: changes stay in memory only */ }
}

export const pendingCount = (): number => read().length;

/** Changes still waiting to be sent, so a screen opened offline can show them. */
export const pending = (): readonly Pending[] => read();

/** True when the request never reached the server (no network), as opposed to the server saying no. */
const isOffline = (e: unknown): boolean => !(e instanceof ApiError);

/**
 * Worth trying again later rather than giving up on: no network, signed out (it goes through once you sign back in),
 * or the server busy or restarting (a reverse proxy answers 502/503/504 while the container updates).
 */
const isTemporary = (e: unknown): boolean =>
  isOffline(e) || (e instanceof ApiError && (e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500));

let dropped = 0;

/** How many waiting changes the server turned down since the last call (the item was deleted meanwhile, say). */
export function takeDropped(): number {
  const n = dropped;
  dropped = 0;
  return n;
}

/**
 * Sends a change now, or keeps it for later when there's no connection. Returns false when it was queued.
 * Anything the server itself refuses is thrown as usual.
 */
export async function sendOrQueue(path: string, method: string, body: unknown): Promise<boolean> {
  // Something is waiting from earlier: try to send it first. The signal may well be back even though the browser
  // never said it went away (a Wi-Fi blip, the server restarting).
  if (read().length) await flushOutbox();
  if (!read().length) {
    try {
      await api(path, { method, body });
      return true;
    } catch (e) {
      if (!isTemporary(e)) throw e;
    }
  }
  // Still waiting: queue behind it so changes reach the server in the order they were made.
  write([...read(), { path, method, body }]);
  return false;
}

let flushing: Promise<number> | null = null;

/** Sends whatever is waiting, oldest first. Resolves to how many went through. */
export function flushOutbox(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    for (;;) {
      const [next] = read();
      if (!next) break;
      try {
        await api(next.path, { method: next.method, body: next.body });
        sent++;
      } catch (e) {
        if (isTemporary(e)) break;
        // The server turned it down (the item was deleted meanwhile, say). Drop it rather than block the rest.
        dropped++;
      }
      // Re-read: more may have been queued while this one was in flight.
      write(read().slice(1));
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

/** On sign-out: forget queued changes and the offline copy of the shopping list, so a shared device keeps nothing. */
export async function forgetDevice(): Promise<void> {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  if ('caches' in window) await caches.delete('nn-api').catch(() => {});
}
