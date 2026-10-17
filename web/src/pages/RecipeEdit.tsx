import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fileToDataUrl, type RecipeFull } from '../api.ts';
import { useApp } from '../state.tsx';
import { emptyRecipe, parseIngredient, type Recipe } from '../../../shared/recipe.ts';
import { formatQuantity } from '../../../shared/units.ts';

/** Ingredients are edited as plain lines ("1 1/2 cups flour, sifted") and parsed into the standard format on save. */
function ingredientLine(i: Recipe['ingredients'][number]): string {
  return [i.quantity != null ? formatQuantity(i.quantity) : '', i.unit ?? '', i.name].filter(Boolean).join(' ')
    + (i.note ? `, ${i.note}` : '') + (i.optional ? ' (optional)' : '');
}

export function RecipeEdit() {
  const { id } = useParams();
  const { base } = useApp();
  const nav = useNavigate();
  const [r, setR] = useState<Recipe>(emptyRecipe());
  const [ingText, setIngText] = useState('');
  const [stepText, setStepText] = useState('');
  const [tagText, setTagText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void api<RecipeFull>(`${base}/recipes/${id}`).then((x) => {
      setR(x);
      setIngText(x.ingredients.map(ingredientLine).join('\n'));
      setStepText(x.instructions.join('\n\n'));
      setTagText(x.tags.join(', '));
    });
  }, [id, base]);

  async function save() {
    const body: Recipe = {
      ...r,
      ingredients: ingText.split('\n').map((l) => l.trim()).filter(Boolean).map(parseIngredient),
      instructions: stepText.split(/\n\s*\n|\n(?=\d+[.)]\s)/).map((s) => s.trim().replace(/^\d+[.)]\s*/, '')).filter(Boolean),
      tags: tagText.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    };
    try {
      const res = id
        ? await api<{ id: string }>(`${base}/recipes/${id}`, { method: 'PUT', body })
        : await api<{ id: string }>(`${base}/recipes`, { body });
      nav(`/recipes/${res.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function photo(file: File | undefined) {
    if (!file) return;
    const { url } = await api<{ url: string }>(`${base}/uploads`, { body: { dataUrl: await fileToDataUrl(file) } });
    setR({ ...r, image: url });
  }

  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="topbar">
        <button className="ghost" onClick={() => nav(-1)}>← Back</button>
        <h1>{id ? 'Edit recipe' : 'New recipe'}</h1>
        <button className="primary" onClick={save} disabled={!r.title.trim()}>Save</button>
      </div>
      <label className="field">Title<input value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} /></label>
      <label className="field">Description<textarea value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} style={{ minHeight: 80 }} /></label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>Servings<input inputMode="numeric" value={r.servings ?? ''} onChange={(e) => setR({ ...r, servings: num(e.target.value) })} /></label>
        <label className="field" style={{ flex: 1 }}>Prep minutes<input inputMode="numeric" value={r.prepMinutes ?? ''} onChange={(e) => setR({ ...r, prepMinutes: num(e.target.value) })} /></label>
        <label className="field" style={{ flex: 1 }}>Cook minutes<input inputMode="numeric" value={r.cookMinutes ?? ''} onChange={(e) => setR({ ...r, cookMinutes: num(e.target.value) })} /></label>
      </div>
      <label className="field">Ingredients, one per line<textarea value={ingText} onChange={(e) => setIngText(e.target.value)} placeholder={'2 cups flour\n1 tsp salt\n3 eggs, beaten'} /></label>
      <label className="field">Steps, separated by a blank line<textarea value={stepText} onChange={(e) => setStepText(e.target.value)} style={{ minHeight: 200 }} /></label>
      <label className="field">Tags, comma separated<input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="dinner, quick, vegetarian" /></label>
      <label className="field">Source link<input value={r.sourceUrl ?? ''} onChange={(e) => setR({ ...r, sourceUrl: e.target.value || null })} /></label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>Photo<input type="file" accept="image/*" onChange={(e) => photo(e.target.files?.[0])} /></label>
        {r.image && <img src={r.image} alt="" style={{ height: 80, borderRadius: 12 }} />}
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
