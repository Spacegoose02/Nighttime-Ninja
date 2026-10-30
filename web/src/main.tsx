import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './state.tsx';
import { App } from './App.tsx';
import { DialogProvider } from './components/Dialog.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DialogProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </DialogProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Installable app and offline shopping list. Browsers only allow this on https (or localhost).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
