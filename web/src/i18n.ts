// Translations. Wrap words people see in t('…'): the English text is the key, so untranslated text just shows
// in English. Each language is a JSON file in web/src/locales mapping English to that language.
// {name}-style placeholders are filled from the second argument: t('Added {item} to the list', { item }).
import es from './locales/es.json';

export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['id'];

const CATALOGS: Record<string, Record<string, string>> = { es };
const KEY = 'nn-language';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && LANGUAGES.some((l) => l.id === saved)) return saved as Lang;
  } catch { /* private mode */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : 'en';
  return LANGUAGES.some((l) => l.id === nav) ? (nav as Lang) : 'en';
}

let lang: Lang = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export function language(): Lang {
  return lang;
}

/** Switches language on this device. The page reloads so every screen picks it up. */
export function setLanguage(next: Lang): void {
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  lang = next;
  if (typeof location !== 'undefined') location.reload();
}

/** For tests. */
export function useLanguageForTests(next: Lang): void {
  lang = next;
}

export function t(text: string, vars?: Record<string, string | number>): string {
  const out = CATALOGS[lang]?.[text] || text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}
