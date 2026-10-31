import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { revalidate, useLoad } from './state.tsx';

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });

describe('useLoad', () => {
  it('shows the last answer at once on the next visit, then the fresh one', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(['milk']));
    const first = renderHook(() => useLoad<string[]>('/api/test/list'));
    await waitFor(() => expect(first.result.current[0]).toEqual(['milk']));
    first.unmount();

    fetch.mockResolvedValueOnce(json(['milk', 'eggs']));
    const again = renderHook(() => useLoad<string[]>('/api/test/list'));
    expect(again.result.current[0]).toEqual(['milk']);
    await waitFor(() => expect(again.result.current[0]).toEqual(['milk', 'eggs']));
  });

  it('shares one request between screens loading the same thing', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ n: 1 }));
    const a = renderHook(() => useLoad('/api/test/shared'));
    const b = renderHook(() => useLoad('/api/test/shared'));
    await waitFor(() => expect(b.result.current[0]).toEqual({ n: 1 }));
    expect(a.result.current[0]).toEqual({ n: 1 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('updates on screen right away with mutate, and refreshes on revalidate', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json([1]));
    const { result } = renderHook(() => useLoad<number[]>('/api/homes/h/things'));
    await waitFor(() => expect(result.current[0]).toEqual([1]));

    act(() => result.current[3]((cur) => [...(cur ?? []), 2]));
    expect(result.current[0]).toEqual([1, 2]);

    fetch.mockResolvedValueOnce(json([1, 2, 3]));
    act(() => revalidate('/api/homes/h'));
    await waitFor(() => expect(result.current[0]).toEqual([1, 2, 3]));
  });
});
