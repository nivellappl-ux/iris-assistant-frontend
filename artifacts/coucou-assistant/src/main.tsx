import { createRoot } from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

if (isTauri()) {
  document.documentElement.classList.add('native-desktop');
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
