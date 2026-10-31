import { describe, expect, it, vi } from 'vitest';
import { flushOutbox, forgetDevice, pending, sendOrQueue } from './offline.ts';

const ok = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
const refused = () => new Response('{"error":"Not found"}', { status: 404 });

describe('offline outbox', () => {
  it('sends straight away when online', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok());
    expect(await sendOrQueue('/api/homes/h/shopping', 'POST', { text: 'milk' })).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(pending()).toHaveLength(0);
  });

  it('keeps changes made with no signal and sends them in order later', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await sendOrQueue('/api/homes/h/shopping/1', 'PATCH', { checked: true })).toBe(false);
    // Once something is waiting, later changes queue behind it even if the network is back.
    fetch.mockImplementation(async () => ok());
    expect(await sendOrQueue('/api/homes/h/shopping/2', 'DELETE', undefined)).toBe(false);
    expect(pending().map((p) => p.method)).toEqual(['PATCH', 'DELETE']);

    expect(await flushOutbox()).toBe(2);
    expect(fetch.mock.calls.slice(-2).map(([url]) => url)).toEqual(['/api/homes/h/shopping/1', '/api/homes/h/shopping/2']);
    expect(pending()).toHaveLength(0);
  });

  it('stops at the first change that still has no signal, and drops ones the server refuses', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await sendOrQueue('/a', 'PATCH', {});
    await sendOrQueue('/b', 'PATCH', {});
    expect(await flushOutbox()).toBe(0);
    expect(pending()).toHaveLength(2);

    fetch.mockResolvedValueOnce(refused()).mockResolvedValueOnce(ok());
    expect(await flushOutbox()).toBe(1);
    expect(pending()).toHaveLength(0);
  });

  it('forgets everything on sign-out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await sendOrQueue('/a', 'PATCH', {});
    await forgetDevice();
    expect(pending()).toHaveLength(0);
  });
});
