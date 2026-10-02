import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGate } from './app/auth';
import { StoreProvider } from './domain/store';
import { ErrorBoundary } from './ui';
import { App } from './app/App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><AuthGate><StoreProvider><App /></StoreProvider></AuthGate></ErrorBoundary></StrictMode>);
