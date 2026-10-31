import { findTimers } from './timers.ts';

export type VoiceCommand =
  | { kind: 'next' | 'back' | 'repeat' | 'ingredients' | 'stepTimer' | 'stop' }
  | { kind: 'timer'; seconds: number; label: string }
  | { kind: 'howMuch'; what: string };

// Spoken numbers come back as words more often than digits.
const NUMBERS: Record<string, string> = {
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  fifteen: '15', twenty: '20', thirty: '30', forty: '40', 'forty five': '45', sixty: '60', ninety: '90',
};

/** What a cook said to cook mode, or null if it wasn't meant for us. */
export function voiceCommand(said: string): VoiceCommand | null {
  const s = said.toLowerCase().replace(/[.,!?]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const timerAsk = /\b(timer|remind me|set (a|an)?\s*\w*\s*for)\b/.test(s);
  if (timerAsk) {
    const words = s.replace(/\b(forty five|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|sixty|ninety)\b/g, (w) => NUMBERS[w]);
    const t = findTimers(words)[0];
    if (t) return { kind: 'timer', seconds: t.seconds, label: t.label };
    if (/\b(start|set)\b/.test(s)) return { kind: 'stepTimer' };
  }
  const much = /\bhow (much|many)(?: of)? (?:the )?(.+?)(?: do i (?:need|use|add))?$/.exec(s);
  if (much) return { kind: 'howMuch', what: much[2] };
  if (/\b(next|continue|done|go on|forward)\b/.test(s)) return { kind: 'next' };
  if (/\b(back|previous|go back|last step)\b/.test(s)) return { kind: 'back' };
  if (/\b(repeat|again|say that|what was that|read it)\b/.test(s)) return { kind: 'repeat' };
  if (/\bingredients\b/.test(s)) return { kind: 'ingredients' };
  if (/\b(stop listening|stop|quiet|be quiet)\b/.test(s)) return { kind: 'stop' };
  return null;
}
