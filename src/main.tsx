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

// Keep document Inter measurements and UI typography ready before mounting.
void Promise.all([
  loadInterFonts(),
  document.fonts.load('400 16px "Onest Variable"'),
  document.fonts.load('650 26px "Bricolage Grotesque Variable"'),
]).catch((error: unknown) => console.error('Could not load bundled fonts:', error)).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
