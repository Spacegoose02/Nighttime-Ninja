// Reading comfort settings that belong to a device rather than a person: a kitchen tablet across the room
// may want bigger text than a phone in your hand.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';

export type TextSize = 'normal' | 'large' | 'xl';
export type FontChoice = 'standard' | 'readable';

const SIZE_KEY = 'nn-text-size';
const FONT_KEY = 'nn-font';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export const textSize = (): TextSize => read(SIZE_KEY, ['normal', 'large', 'xl'] as const, 'normal');
export const fontChoice = (): FontChoice => read(FONT_KEY, ['standard', 'readable'] as const, 'standard');

export function applyDevicePrefs(): void {
  document.documentElement.dataset.text = textSize();
  document.documentElement.dataset.font = fontChoice();
}

export function setTextSize(v: TextSize): void {
  try { localStorage.setItem(SIZE_KEY, v); } catch { /* private mode */ }
  applyDevicePrefs();
}

export function setFontChoice(v: FontChoice): void {
  try { localStorage.setItem(FONT_KEY, v); } catch { /* private mode */ }
  applyDevicePrefs();
}
