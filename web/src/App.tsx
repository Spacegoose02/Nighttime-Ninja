import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './state.tsx';
import { RaccoonAvatar } from './components/Raccoon.tsx';
import { Login } from './pages/Login.tsx';
import { HomeSetup } from './pages/HomeSetup.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Inventory } from './pages/Inventory.tsx';
import { Recipes } from './pages/Recipes.tsx';
import { RecipeDetail } from './pages/RecipeDetail.tsx';
import { Shopping } from './pages/Shopping.tsx';
import { MealPlan } from './pages/MealPlan.tsx';
import { PublicRecipe, Community } from './pages/Public.tsx';
import { Modal } from './components/Dialog.tsx';
import { TimerBar } from './components/Timers.tsx';
import { Icon, type IconName } from './components/Icon.tsx';
import { CommandBar } from './components/CommandBar.tsx';
import { t } from './i18n.ts';

// The bigger, less-visited pages load the first time they're opened, so the app starts faster on tablets.
const RecipeEdit = lazy(() => import('./pages/RecipeEdit.tsx').then((m) => ({ default: m.RecipeEdit })));
const ImportPage = lazy(() => import('./pages/Import.tsx').then((m) => ({ default: m.ImportPage })));
const Deals = lazy(() => import('./pages/Deals.tsx').then((m) => ({ default: m.Deals })));
const Mixologist = lazy(() => import('./pages/Mixologist.tsx').then((m) => ({ default: m.Mixologist })));
const Feed = lazy(() => import('./pages/Feed.tsx').then((m) => ({ default: m.Feed })));
const Settings = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.Settings })));
const Chef = lazy(() => import('./pages/Chef.tsx').then((m) => ({ default: m.Chef })));

const NAV: { to: string; ico: IconName; label: string; end?: boolean; group: 'kitchen' | 'helpers' | 'discover' | 'you' }[] = [
  { to: '/', ico: 'home', label: 'Home', end: true, group: 'kitchen' },
  { to: '/inventory', ico: 'pantry', label: 'Pantry', group: 'kitchen' },
  { to: '/recipes', ico: 'recipes', label: 'Recipes', group: 'kitchen' },
  { to: '/shopping', ico: 'shopping', label: 'Shopping', group: 'kitchen' },
  { to: '/plan', ico: 'plan', label: 'Meal Plan', group: 'kitchen' },
  { to: '/chef', ico: 'chef', label: 'Chef Gordy', group: 'helpers' },
  { to: '/mixologist', ico: 'bar', label: 'Mixologist', group: 'helpers' },
  { to: '/deals', ico: 'deals', label: 'Deals', group: 'discover' },
  { to: '/feed', ico: 'feed', label: 'Feed', group: 'discover' },
  { to: '/settings', ico: 'settings', label: 'Settings', group: 'you' },
];

/** The phone tab bar keeps these; everything else lives under More. */
const PHONE_TABS = new Set(['/', '/inventory', '/recipes', '/shopping']);

/** The pages this home uses: managers can hide Meal Plan, Gordy, the Mixologist, Deals or Feed. */
function useNav() {
  const { home } = useApp();
  const hidden = new Set(home?.hiddenPages ?? []);
  return NAV.filter((n) => !hidden.has(n.to));
}

/** Opens the app-wide search with Ctrl+K / Cmd+K, or "/" when not typing. */
function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

function NavItem({ n, onClick }: { n: (typeof NAV)[number]; onClick?: () => void }) {
  return (
    <NavLink to={n.to} end={n.end} onClick={onClick} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      <Icon name={n.ico} className="ico" />
      {t(n.label)}
    </NavLink>
  );
}

function Rail({ onSearch }: { onSearch: () => void }) {
  const { me } = useApp();
  const nav = useNav();
  return (
    <nav className="rail" aria-label="Main">
      <div className="brand" title="Nighttime Ninja">
        <RaccoonAvatar variant={me?.user.avatar} size={56} />
      </div>
      <button className="nav-link ghost" onClick={onSearch} aria-keyshortcuts="Control+K" title={t('Search (Ctrl+K)')}>
        <Icon name="search" className="ico" />
        {t('Search')}
      </button>
      {nav.map((n, i) => (
        <span key={n.to} className="nav-group-item">
          {i > 0 && nav[i - 1].group !== n.group && <hr className="nav-sep" />}
          <NavItem n={n} />
        </span>
      ))}
    </nav>
  );
}

function BottomBar({ onSearch }: { onSearch: () => void }) {
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const nav = useNav();
  const extra = nav.filter((n) => !PHONE_TABS.has(n.to));
  const inMore = extra.some((n) => loc.pathname.startsWith(n.to));
  useEffect(() => setMore(false), [loc.pathname]);
  return (
    <nav className="bottom-bar" aria-label="Main">
      {nav.filter((n) => PHONE_TABS.has(n.to)).map((n) => <NavItem key={n.to} n={n} />)}
      <button className={`nav-link ghost${inMore ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
        <Icon name="more" className="ico" />
        {t('More')}
      </button>
      {more && (
        <Modal label={t('More')} className="sheet" onClose={() => setMore(false)}>
          <div className="sheet-grid">
            <button className="nav-link" onClick={() => { setMore(false); onSearch(); }}><Icon name="search" className="ico" />{t('Search')}</button>
            {extra.map((n) => <NavItem key={n.to} n={n} onClick={() => setMore(false)} />)}
          </div>
        </Modal>
      )}
    </nav>
  );
}

export function App() {
  const { me, loading, home } = useApp();
  const loc = useLocation();
  const [search, setSearch] = useState(false);
  const openSearch = useCallback(() => setSearch(true), []);
  useSearchShortcut(openSearch);
  const nav = NAV.filter((n) => !(home?.hiddenPages ?? []).includes(n.to));

  // Shared recipes are readable without signing in.
  if (loc.pathname.startsWith('/r/')) {
    return (
      <Routes>
        <Route path="/r/:slug" element={<PublicRecipe />} />
      </Routes>
    );
  }
  if (loading) {
    return <div className="center-screen"><RaccoonAvatar variant="chef" size={96} title="Loading" /></div>;
  }
  if (!me) return <Login />;
  if (!home) return <HomeSetup />;

  return (
    <div className="layout">
      <Rail onSearch={openSearch} />
      <main className="main">
        <Suspense fallback={<div className="center-screen"><RaccoonAvatar variant="chef" size={72} title="Loading" /></div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/recipes/new" element={<RecipeEdit />} />
            <Route path="/recipes/import" element={<ImportPage />} />
            <Route path="/recipes/community" element={<Community />} />
            <Route path="/recipes/:id" element={<RecipeDetail />} />
            <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="/plan" element={<MealPlan />} />
            <Route path="/mixologist" element={<Mixologist />} />
            <Route path="/chef" element={<Chef />} />
            <Route path="/deals" element={<Deals />} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/home/new" element={<HomeSetup inline />} />
            <Route path="*" element={<div className="card">{t('That page wandered off.')} <NavLink to="/">{t('Go home')}</NavLink></div>} />
          </Routes>
        </Suspense>
      </main>
      <TimerBar />
      <BottomBar onSearch={openSearch} />
      {search && <CommandBar pages={nav} onClose={() => setSearch(false)} />}
    </div>
  );
}
