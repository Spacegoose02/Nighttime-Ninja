import { useEffect, useState, useSyncExternalStore } from 'react';
import { clock } from '../../../shared/timers.ts';

export interface RunningTimer { id: number; label: string; endsAt: number; done: boolean }

// Kept outside React so timers keep running when you leave the recipe, and show on every screen.
let timers: RunningTimer[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
let nextId = 1;

export function startTimer(label: string, seconds: number): void {
  timers = [...timers, { id: nextId++, label, endsAt: Date.now() + seconds * 1000, done: false }];
  emit();
}

function stopTimer(id: number): void {
  timers = timers.filter((t) => t.id !== id);
  emit();
}

function addTime(id: number, seconds: number): void {
  timers = timers.map((t) => (t.id === id ? { ...t, endsAt: Math.max(Date.now(), t.endsAt) + seconds * 1000, done: false } : t));
  emit();
}

function useTimers(): RunningTimer[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => timers);
}

/** Three short beeps, made in the browser so there's no sound file to load. */
function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.25;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.35);
      osc.stop(ctx.currentTime + i * 0.35 + 0.2);
    }
    window.setTimeout(() => void ctx.close(), 1500);
  } catch { /* no audio */ }
  navigator.vibrate?.([300, 150, 300, 150, 300]);
}

/** Running kitchen timers, pinned to the bottom of the screen. */
export function TimerBar() {
  const list = useTimers();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!list.length) return;
    const t = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      const finished = timers.filter((x) => !x.done && x.endsAt <= at);
      if (finished.length) {
        timers = timers.map((x) => (finished.includes(x) ? { ...x, done: true } : x));
        emit();
        beep();
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [list.length]);
  // Keep beeping every few seconds until someone stops a finished timer.
  const ringing = list.some((t) => t.done);
  useEffect(() => {
    if (!ringing) return;
    const t = window.setInterval(beep, 4000);
    return () => window.clearInterval(t);
  }, [ringing]);
  if (!list.length) return null;
  return (
    <section className="timer-bar" aria-label="Timers">
      {list.map((t) => (
        <div key={t.id} className={`timer${t.done ? ' ringing' : ''}`} role={t.done ? 'alert' : undefined}>
          <span className="timer-time">{t.done ? '⏰ Done' : clock((t.endsAt - now) / 1000)}</span>
          <span className="timer-label">{t.label}</span>
          <button className="ghost" onClick={() => addTime(t.id, 60)} aria-label={`Add a minute to ${t.label}`}>+1 min</button>
          <button onClick={() => stopTimer(t.id)}>{t.done ? 'Stop' : 'Cancel'}</button>
        </div>
      ))}
    </section>
  );
}

/** Keeps the screen on while cook mode is open, where the browser allows it. */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const take = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) void l.release(); else lock = l;
      } catch { /* low battery or not allowed */ }
    };
    // The browser drops the lock when the tab is hidden; take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') void take(); };
    void take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [on]);
}
