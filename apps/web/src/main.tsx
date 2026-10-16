import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
// Self-hosted; only the subsets a page's text needs are fetched, by unicode-range.
import '@fontsource-variable/manrope/index.css';
import '@fontsource-variable/newsreader/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) registerSW({ immediate: true });
