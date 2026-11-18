import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { AgentProvider, NetworkProvider } from './app/context';
import { NetDataProvider } from './app/data';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/app.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AgentProvider>
          <NetworkProvider>
            <NetDataProvider>
              <App />
            </NetDataProvider>
          </NetworkProvider>
        </AgentProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
