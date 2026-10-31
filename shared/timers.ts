export interface StepTimer {
  /** The words that named the time, e.g. "25 to 30 minutes". */
  label: string;
  /** Length in seconds, from the low end of a range. */
  seconds: number;
}

const UNIT = String.raw`(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b`;
const NUM = String.raw`(\d+(?:\.\d+)?|an?|one|half an?)`;
const TIME = new RegExp(String.raw`\b${NUM}(?:\s*(?:-|–|to|or)\s*(\d+(?:\.\d+)?))?\s*${UNIT}(?:\s+(?:and\s+)?(\d+)\s*(minutes?|mins?|m)\b)?`, 'gi');

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, 'half a': 0.5, 'half an': 0.5 };

function secondsFor(unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('h')) return 3600;
  if (u.startsWith('m')) return 60;
  return 1;
}

/** Finds the times in a recipe step ("bake 25 to 30 minutes", "simmer 1 hour 15 minutes") so cook mode can offer timers. */
export function findTimers(step: string): StepTimer[] {
  const out: StepTimer[] = [];
  for (const m of step.matchAll(TIME)) {
    const [label, n, , unit, extra] = m;
    // A lone "m", "h" or "s" only counts right after a number ("10m"), never "an h".
    if (unit.length === 1 && !/^\d/.test(n)) continue;
    const value = WORDS[n.toLowerCase()] ?? Number(n);
    let seconds = Math.round(value * secondsFor(unit));
    if (extra) seconds += Number(extra) * 60;
    if (seconds >= 5 && seconds <= 48 * 3600) out.push({ label: label.trim(), seconds });
  }
  return out;
}

/** "1:05:00", "12:30", "0:45" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
