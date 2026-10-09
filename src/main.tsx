import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadInterFonts } from './render/fonts/inter';
import './index.css';

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}

// Mount after the UI font is ready so the first canvas measurements cannot cache a fallback.
void loadInterFonts().catch((error: unknown) => console.error('Could not load Inter:', error)).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
