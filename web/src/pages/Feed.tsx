import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Recipe } from '../../../shared/recipe.ts';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

interface Entry { feedId: string; feedTitle: string; title: string; link: string; published: string | null; thumbnail: string | null; videoId: string | null; summary: string | null }
interface FeedRow { id: string; title: string; url: string }

export function Feed() {
  const { base, toast } = useApp();
  const [feeds, reloadFeeds] = useLoad<FeedRow[]>(`${base}/feeds`);
  const [data, reload] = useLoad<{ entries: Entry[]; failed: string[] }>(`${base}/feeds/items`);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [ai] = useLoad<{ available: boolean }>('/api/mixologist/status');
  const nav = useNavigate();

  // Videos: Gordy reads the recipe from the description. Blog posts: the regular importer reads the page.
  async function saveRecipe(e: Entry) {
    setSaving(e.link);
    try {
      let id: string;
      if (e.videoId) {
        const { recipes } = await api<{ recipes: Recipe[] }>(`${base}/recipes/from-video`, { body: { url: `https://www.youtube.com/watch?v=${e.videoId}` } });
        id = (await api<{ id: string }>(`${base}/recipes`, { body: { ...recipes[0], image: e.thumbnail } })).id;
      } else {
        id = (await api<{ ids: string[] }>(`${base}/recipes/import`, { body: { url: e.link, save: true } })).ids[0];
      }
      toast('Saved to your recipes');
      nav(`/recipes/${id}`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function follow() {
    setBusy(true);
    try {
      const f = await api<{ title: string }>(`${base}/feeds`, { body: { url } });
      toast(`Following ${f.title}`);
      setUrl('');
      await Promise.all([reloadFeeds(), reload()]);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const entries = (data?.entries ?? []).filter((e) => !filter || e.feedId === filter);
  return (
    <div className="stack">
      <div className="topbar">
        <h1>Feed</h1>
        <button onClick={() => setManage(!manage)}>{manage ? 'Done' : 'Manage cooks'}</button>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void follow(); }}>
        <input placeholder="Follow a cook: YouTube channel link, blog, or RSS feed" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={!url || busy}>{busy ? 'Finding feed…' : 'Follow'}</button>
      </form>
      {!!feeds?.length && (
        <div className="chips">
          <button className={`chip${!filter ? ' on' : ''}`} onClick={() => setFilter(null)}>Everyone</button>
          {feeds.map((f) => (
            <span key={f.id} className="row" style={{ gap: 4 }}>
              <button className={`chip${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>{f.title}</button>
              {manage && <button className="ghost icon" aria-label={`Unfollow ${f.title}`} onClick={async () => { await api(`${base}/feeds/${f.id}`, { method: 'DELETE' }); await Promise.all([reloadFeeds(), reload()]); }}>✕</button>}
            </span>
          ))}
        </div>
      )}
      {feeds && !feeds.length && <div className="card">Follow your favorite cooks to see their newest videos and posts here. Paste a YouTube channel link (like youtube.com/@channelname) or any blog with an RSS feed.</div>}
      {!!data?.failed.length && <p className="small muted">Couldn't load: {data.failed.join(', ')}</p>}
      <div className="video-grid">
        {entries.map((e, i) => (
          <div key={`${e.link}-${i}`} className="card video">
            {playing === e.videoId && e.videoId ? (
              // No autoplay: browsers and phone web views only let an embedded player autoplay muted, so YouTube
              // started the video silently. Tapping YouTube's own play button starts it with sound everywhere.
              <iframe src={`https://www.youtube-nocookie.com/embed/${e.videoId}?playsinline=1&origin=${encodeURIComponent(location.origin)}`} title={e.title} referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; web-share" allowFullScreen />
            ) : e.videoId ? (
              <button className="thumb" style={{ padding: 0, border: 0, borderRadius: 0, minHeight: 0 }} onClick={() => setPlaying(e.videoId)} aria-label={`Play ${e.title}`}>
                {e.thumbnail && <img src={e.thumbnail} alt="" loading="lazy" />}
              </button>
            ) : e.thumbnail ? (
              <a className="thumb" href={e.link} target="_blank" rel="noreferrer"><img src={e.thumbnail} alt="" loading="lazy" /></a>
            ) : null}
            <div style={{ padding: 12 }}>
              <a href={e.link} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'inherit', textDecoration: 'none' }}>{e.title}</a>
              <div className="small muted">{e.feedTitle}{e.published && ` · ${new Date(e.published).toLocaleDateString()}`}</div>
              {(!e.videoId || ai?.available) && (
                <button className="ghost small" style={{ marginTop: 6 }} disabled={saving === e.link} onClick={() => saveRecipe(e)}>
                  {saving === e.link ? 'Reading the recipe…' : '📖 Save the recipe'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
