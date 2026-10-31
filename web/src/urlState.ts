import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A bit of page state (search text, a filter, a tab) kept in the address instead of in memory,
 * so going back to the page brings it back exactly as it was left. Changes replace the current
 * history entry, so typing a search doesn't add a back-button step per letter.
 */
export function useUrlState(key: string, fallback = ''): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback((next: string) => {
    setParams((cur) => {
      const p = new URLSearchParams(cur);
      if (next && next !== fallback) p.set(key, next); else p.delete(key);
      return p;
    }, { replace: true });
  }, [key, fallback, setParams]);
  return [value, set];
}
