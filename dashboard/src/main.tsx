// Entry point.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fonts are bundled with the app (Fontsource), so the frame needs no internet for them.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';

// Global styles: theme tokens, then foundations, then shared building blocks. Everything else is a
// *.module.css imported by its component (after these, so components can adjust shared pieces).
import '../css/tokens.css';
import '../css/base.css';
import '../css/components.css';

import { App } from './app/App';
import { IS_KIOSK } from './app/layout';
import { startApp } from './app/start';

// The service worker receives photos shared to the installed app (public/sw.js). Not on the frame,
// and only where browsers allow it (HTTPS or localhost).
if ('serviceWorker' in navigator && !IS_KIOSK) {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker not registered', e));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
startApp();
