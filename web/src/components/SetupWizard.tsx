// First visit to a new home: three short steps. Where you are (money and measurements), your language,
// then how to get started (a sample kitchen, an import, or a blank slate).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp } from '../state.tsx';
import { LANGUAGES, language, setLanguage, t, type Lang } from '../i18n.ts';
import { guessRegion, REGIONS } from '../regions.ts';

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const { base, home, me, toast, refresh } = useApp();
  const manager = home?.role === 'manager';
  const [step, setStep] = useState(manager ? 0 : 2);
  const [region, setRegion] = useState(() => guessRegion().id);
  const [lang, setLang] = useState<Lang>(language());
  const [busy, setBusy] = useState(false);

  async function saveRegion() {
    const r = REGIONS.find((x) => x.id === region) ?? REGIONS[0];
    setBusy(true);
    try {
      const hidden = (home?.hiddenPages ?? []).filter((p) => p !== '/deals');
      await api(base, { method: 'PATCH', body: { currency: r.currency, hiddenPages: r.deals ? hidden : [...hidden, '/deals'] } });
      if (me?.user.units !== r.units) await api('/api/me', { method: 'PATCH', body: { units: r.units } });
      await refresh();
      setStep(1);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  async function sample() {
    setBusy(true);
    try {
      const r = await api<{ recipes: number; items: number }>(`${base}/sample-data`, { body: {} });
      toast(t('Added {recipes} recipes and {items} pantry items to try things out', r));
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="card stack welcome">
      <h2 style={{ margin: 0 }}>{t('Welcome to Nighttime Ninja')} 🦝</h2>
      {manager && <p className="small muted" style={{ margin: 0 }}>{t('Step {n} of 3', { n: step + 1 })}</p>}

      {step === 0 && (
        <>
          <label className="field">
            {t('Where is your kitchen?')}
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <p className="small muted" style={{ margin: 0 }}>
            {t('This sets your currency ({currency}) and measurements ({units}). You can change both in Settings.', {
              currency: REGIONS.find((r) => r.id === region)?.currency ?? 'USD',
              units: REGIONS.find((r) => r.id === region)?.units === 'us' ? t('cups, ounces, °F') : t('grams, millilitres, °C'),
            })}
          </p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={saveRegion}>{t('Next')}</button>
            <button className="ghost" onClick={onDone}>{t('Skip setup')}</button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <span style={{ fontWeight: 600 }}>{t('Language on this device')}</span>
          <div className="chips">
            {LANGUAGES.map((l) => <button key={l.id} className={`chip${lang === l.id ? ' on' : ''}`} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>{l.name}</button>)}
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t('Everyone in the home can pick their own. More languages are welcome: see the project on GitHub.')}</p>
          <div className="row">
            <button className="primary" onClick={() => { setStep(2); if (lang !== language()) setLanguage(lang); }}>{t('Next')}</button>
            <button className="ghost" onClick={() => setStep(0)}>{t('Back')}</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="muted" style={{ margin: 0 }}>{t("Here's how most kitchens get going:")}</p>
          <ol className="welcome-steps">
            <li><Link to="/inventory">{t("Add what's in your pantry")}</Link>, {t('or scan barcodes as you put groceries away.')}</li>
            <li><Link to="/recipes/import">{t('Bring in recipes')}</Link> {t('from any recipe website, or paste one in.')}</li>
            <li><Link to="/settings?section=kitchen">{t('Tick the kitchen tools you have')}</Link>, {t('so recipes and Gordy know what you can make.')}</li>
            <li><Link to="/plan">{t('Plan a few dinners')}</Link> {t('and let the app fill your shopping list.')}</li>
            <li><Link to="/settings?section=home">{t('Invite your household')}</Link> {t("with the home's join code.")}</li>
          </ol>
          <div className="row">
            {manager && <button className="primary" disabled={busy} onClick={sample}>🧺 {t('Load a sample kitchen')}</button>}
            <button className="ghost" onClick={onDone}>{t("I'll start from scratch")}</button>
          </div>
        </>
      )}
    </div>
  );
}
