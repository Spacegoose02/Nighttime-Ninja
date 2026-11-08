import { afterEach, describe, expect, it } from 'vitest';
import { t, useLanguageForTests } from './i18n.ts';
import es from './locales/es.json';
import { guessRegion, REGIONS } from './regions.ts';

afterEach(() => useLanguageForTests('en'));

describe('translations', () => {
  it('shows the English text when nothing is translated', () => {
    useLanguageForTests('en');
    expect(t('Shopping')).toBe('Shopping');
    expect(t('Added {item} to the list', { item: 'milk' })).toBe('Added milk to the list');
  });
  it('uses the Spanish catalog and fills placeholders', () => {
    useLanguageForTests('es');
    expect(t('Shopping')).toBe('Compras');
    expect(t('Added {item} to the list', { item: 'leche' })).toBe('leche añadido a la lista');
    expect(t('A sentence nobody translated')).toBe('A sentence nobody translated');
  });
  it('keeps every placeholder in the Spanish text', () => {
    for (const [en, tr] of Object.entries(es as Record<string, string>)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');
      expect(vars(tr), en).toBe(vars(en));
    }
  });
});

describe('regions', () => {
  it('guesses from the browser language', () => {
    expect(guessRegion('en-GB').currency).toBe('GBP');
    expect(guessRegion('es-MX').id).toBe('MX');
    expect(guessRegion('fr').id).toBe('US');
  });
  it('has valid currency codes and unique ids', () => {
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(REGIONS.length);
    for (const r of REGIONS) expect(() => new Intl.NumberFormat('en', { style: 'currency', currency: r.currency })).not.toThrow();
  });
});
