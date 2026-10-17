import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './pwa/registerServiceWorker';
import { installStore } from './pwa/installPrompt';
import { installAnalytics } from './analytics/googleAnalytics';
import { screenFromSearch } from './state/view';
import './styles/app.css';
import './styles/redesign.css';
import './styles/scope-statistics.css';
import './styles/layout.css';

registerServiceWorker();
// Attach the beforeinstallprompt/appinstalled listeners now, before the first paint — a prompt fired before
// InstallButton mounts (unlikely but not impossible) must not be missed.
installStore();
installAnalytics(screenFromSearch(window.location.search));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
