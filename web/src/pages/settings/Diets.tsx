import { api, type HomeDetail } from '../../api.ts';
import { useApp } from '../../state.tsx';
import { DIETS } from '../../../../shared/diets.ts';

/** Each person's diets and allergies. Recipes warn when they clash, and Gordy and Rocco plan around them. */
export function DietsAndAllergies({ home, reload }: { home: HomeDetail; reload: () => Promise<void> }) {
  const { base, me, toast } = useApp();
  const save = async (id: string, diets: string[], allergies: string[]) => {
    try { await api(`${base}/members/${id}/diet`, { method: 'PUT', body: { diets, allergies } }); } catch (e) { toast((e as Error).message); }
    await reload();
  };
  return (
    <>
      <h3>Diets and allergies</h3>
      <p className="small muted" style={{ margin: 0 }}>Recipes show a warning when an ingredient clashes, and Gordy and Rocco cook around them.</p>
      <div className="list">
        {home.members.map((m) => {
          const canEdit = m.id === me!.user.id || home.role === 'manager';
          return (
            <div key={m.id} className="list-item" style={{ flexWrap: 'wrap' }}>
              <strong style={{ minWidth: 120 }}>{m.name}</strong>
              <div className="chips" style={{ flex: 1 }}>
                {DIETS.map((d) => {
                  const on = m.diets.includes(d);
                  return (
                    <button key={d} className={`chip${on ? ' on' : ''}`} disabled={!canEdit} aria-pressed={on}
                      onClick={() => save(m.id, on ? m.diets.filter((x) => x !== d) : [...m.diets, d], m.allergies)}>{d}</button>
                  );
                })}
              </div>
              <input key={m.allergies.join()} aria-label={`Allergies for ${m.name}`} defaultValue={m.allergies.join(', ')} disabled={!canEdit}
                placeholder="Allergies, e.g. peanuts, shellfish" style={{ flex: '1 1 220px' }}
                onBlur={(e) => {
                  const next = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                  if (next.join() !== m.allergies.join()) void save(m.id, m.diets, next);
                }} />
            </div>
          );
        })}
      </div>
    </>
  );
}
