// Settings: one page per tab, each at its own address (/settings/profile, /settings/sign-in...), grouped into
// You, Home and Server admin. Search finds the right tab by what's on it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { t } from '../i18n.ts';
import { useApp } from '../state.tsx';
import { VersionCard } from '../components/UpdateBanner.tsx';
import { SecurityCard } from './Security.tsx';
import { AdminServer, AdminUsers } from './settings/Admin.tsx';
import { PlacesAndCategories } from './settings/Labels.tsx';
import { KitchenTools } from './settings/KitchenTools.tsx';
import { Reminders } from './settings/Reminders.tsx';
import { Appearance, LinkedAccounts, Profile } from './settings/You.tsx';
import { HomeConnections, HomeData, HomeGeneral } from './settings/HomePages.tsx';
import { SignInSettings } from './settings/SignIn.tsx';

interface Tab { path: string; label: string; group: 'you' | 'home' | 'admin'; words: string; page: () => ReactNode }

const TABS: Tab[] = [
  { path: 'profile', label: 'Profile', group: 'you', words: 'name avatar picture pair tablet phone device sign out', page: () => <Profile /> },
  { path: 'appearance', label: 'Look and feel', group: 'you', words: 'theme colour color dark measurements units metric us cups language text size font', page: () => <Appearance /> },
  { path: 'security', label: 'Sign-in and security', group: 'you', words: 'password two-factor 2fa passkey devices sessions tinyauth link sso single sign-on', page: () => <><LinkedAccounts /><SecurityCard /></> },
  { path: 'reminders', label: 'Reminders', group: 'you', words: 'notifications push expiring meals shopping', page: () => <Reminders /> },
  { path: 'home', label: 'Home', group: 'home', words: 'name currency pages hide invite join code people members manager diets allergies', page: () => <HomeGeneral /> },
  { path: 'kitchen', label: 'Kitchen', group: 'home', words: 'places categories pantry locations tools equipment gear', page: () => <><PlacesAndCategories /><KitchenTools /></> },
  { path: 'connections', label: 'Connections', group: 'home', words: 'google calendar stores kroger den duty home assistant mcp ai tokens api automations', page: () => <HomeConnections /> },
  { path: 'data', label: 'Download and delete', group: 'home', words: 'export download json paprika backup delete home', page: () => <HomeData /> },
  { path: 'sign-in', label: 'Sign-in', group: 'admin', words: 'tinyauth oidc openid sso single sign-on accounts signup invite quick sign-in authelia pocket id', page: () => <SignInSettings /> },
  { path: 'users', label: 'Users', group: 'admin', words: 'people accounts admin temp password 2fa turn off delete link tinyauth homes', page: () => <AdminUsers /> },
  { path: 'server', label: 'Server', group: 'admin', words: 'ai claude model web search usage cost backups', page: () => <AdminServer /> },
  { path: 'about', label: 'About', group: 'you', words: 'version updates license', page: () => <><VersionCard /><p className="small muted">Nighttime Ninja is open source under the MIT license.</p></> },
];

const GROUPS = [
  { key: 'you', label: 'You' },
  { key: 'home', label: 'Home' },
  { key: 'admin', label: 'Server admin' },
] as const;

// Old addresses (/settings?section=home) from bookmarks, the setup wizard and Google Calendar's way back.
const OLD_SECTIONS: Record<string, string> = { you: 'profile', home: 'home', kitchen: 'kitchen', server: 'users' };

function Start() {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  if (q.get('calendar')) return <Navigate to={`/settings/connections${search}`} replace />;
  return <Navigate to={`/settings/${OLD_SECTIONS[q.get('section') ?? ''] ?? 'profile'}`} replace />;
}

export function Settings() {
  const { me } = useApp();
  const [q, setQ] = useState('');
  const { pathname } = useLocation();
  const nav = useRef<HTMLElement>(null);
  // On a phone the tabs scroll sideways: keep the open one in view whenever the page changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value used inside.
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>('.settings-tab.on')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  const isAdmin = !!me?.user.isAdmin;
  const tabs = TABS.filter((x) => x.group !== 'admin' || isAdmin);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? tabs.filter((x) => words.every((w) => `${t(x.label)} ${x.label} ${x.words}`.toLowerCase().includes(w))) : tabs;
  return (
    <div className="stack settings-page">
      <div className="topbar"><h1>{t('Settings')}</h1></div>
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label={t('Settings')} ref={nav}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search settings')} aria-label={t('Search settings')} />
          {!shown.length && <p className="small muted" style={{ margin: 0 }}>{t('No setting mentions “{q}”.', { q })}</p>}
          <div className="settings-tab-row">
            {GROUPS.map((g) => {
              const list = shown.filter((x) => x.group === g.key);
              if (!list.length) return null;
              return (
                <div key={g.key} className="settings-group">
                  <span className="settings-group-label">{t(g.label)}</span>
                  {list.map((x) => (
                    <NavLink key={x.path} to={`/settings/${x.path}`} className={({ isActive }) => `settings-tab${isActive ? ' on' : ''}`} onClick={() => setQ('')}>{t(x.label)}</NavLink>
                  ))}
                </div>
              );
            })}
          </div>
        </nav>
        <div className="settings-content stack">
          <Routes>
            <Route index element={<Start />} />
            {tabs.map((x) => <Route key={x.path} path={x.path} element={<><h2 className="settings-title">{t(x.label)}</h2>{x.page()}</>} />)}
            <Route path="*" element={<Navigate to="/settings/profile" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
