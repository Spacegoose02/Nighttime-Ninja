import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const STORE = 'nn-scroll';
/** How long to keep trying to reach a saved spot while the page's list loads in. */
const RESTORE_MS = 2000;

function readSaved(): Record<string, number> {
  try { return JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as Record<string, number>; } catch { return {}; }
}
const saved = readSaved();
/** The page on screen right now; scroll events that arrive late for a page already left are ignored. */
let current = '';
function persist() {
  try {
    // Only the most recent pages are worth keeping.
    const keys = Object.keys(saved);
    for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete saved[k];
    sessionStorage.setItem(STORE, JSON.stringify(saved));
  } catch { /* private mode or full storage: scroll memory just lasts until reload */ }
}

/**
 * Remembers how far down each visited page was scrolled. Going back (browser, Android or mouse back
 * button) returns to that spot; opening a new page starts at the top.
 */
export function ScrollMemory() {
  const { key, pathname } = useLocation();
  const nav = useNavigationType();

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.addEventListener('pagehide', persist);
    return () => window.removeEventListener('pagehide', persist);
  }, []);

  const lastPath = useRef(pathname);

  useLayoutEffect(() => {
    current = key;
    // Opening a different page starts at the top. Filter changes on the same page stay put.
    if (nav === 'PUSH' && pathname !== lastPath.current) window.scrollTo(0, 0);
    lastPath.current = pathname;
  }, [key, nav, pathname]);

  useEffect(() => {
    const target = nav === 'POP' ? saved[key] ?? 0 : null;
    let restoring = target != null && target > 0;
    let frame = 0;
    const started = performance.now();
    const stop = () => { restoring = false; cancelAnimationFrame(frame); };
    // The list may still be loading, so keep nudging until the page is tall enough to land on the spot.
    const step = () => {
      if (!restoring || target == null) return;
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) < 2 || performance.now() - started > RESTORE_MS) stop();
      else frame = requestAnimationFrame(step);
    };
    if (restoring) step();

    const onScroll = () => { if (!restoring && current === key) saved[key] = window.scrollY; };
    // Any scrolling by the person wins over restoring.
    const interrupt = () => stop();
    window.addEventListener('scroll', onScroll, { passive: true });
    for (const e of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(e, interrupt, { passive: true });
    return () => {
      stop();
      window.removeEventListener('scroll', onScroll);
      for (const e of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(e, interrupt);
      persist();
    };
  }, [key, nav]);

  return null;
}
