import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './state.tsx';
import { RaccoonAvatar } from './components/Raccoon.tsx';
import { Login } from './pages/Login.tsx';
import { HomeSetup } from './pages/HomeSetup.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Inventory } from './pages/Inventory.tsx';
import { Recipes } from './pages/Recipes.tsx';
import { RecipeDetail } from './pages/RecipeDetail.tsx';
import { RecipeEdit } from './pages/RecipeEdit.tsx';
import { ImportPage } from './pages/Import.tsx';
import { Shopping } from './pages/Shopping.tsx';
import { MealPlan } from './pages/MealPlan.tsx';
import { Deals } from './pages/Deals.tsx';
import { Mixologist } from './pages/Mixologist.tsx';
import { Feed } from './pages/Feed.tsx';
import { Settings } from './pages/Settings.tsx';
import { PublicRecipe, Community } from './pages/Public.tsx';

const NAV = [
  { to: '/', ico: '🏠', label: 'Home', end: true },
  { to: '/inventory', ico: '🥫', label: 'Pantry' },
  { to: '/recipes', ico: '📖', label: 'Recipes' },
  { to: '/shopping', ico: '🛒', label: 'Shopping' },
  { to: '/plan', ico: '📅', label: 'Meal Plan' },
  { to: '/mixologist', ico: '🍸', label: 'Mixologist' },
  { to: '/deals', ico: '🏷️', label: 'Deals' },
  { to: '/feed', ico: '📺', label: 'Feed' },
  { to: '/settings', ico: '⚙️', label: 'Settings' },
];

function Nav({ className }: { className: string }) {
  const { me } = useApp();
  return (
    <nav className={className} aria-label="Main">
      {className === 'rail' && (
        <div className="brand" title="Nighttime Ninja">
          <RaccoonAvatar variant={me?.user.avatar} size={56} />
        </div>
      )}
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <span className="ico" aria-hidden>{n.ico}</span>
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function App() {
  const { me, loading, home } = useApp();
  const loc = useLocation();

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
      <Nav className="rail" />
      <main className="main">
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
          <Route path="/deals" element={<Deals />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/home/new" element={<HomeSetup inline />} />
          <Route path="*" element={<div className="card">That page wandered off. <NavLink to="/">Go home</NavLink></div>} />
        </Routes>
      </main>
      <Nav className="bottom-bar" />
    </div>
  );
}
