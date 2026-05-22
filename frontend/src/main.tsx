import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/sonner';
import { applyTheme, getInitialTheme } from './lib/theme';
import './index.css';

// Apply the theme synchronously before React mounts so the very first paint
// already has the correct surface color — no flash from default-dark to light.
applyTheme(getInitialTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider>
          <App />
        </TooltipProvider>
        <Toaster position="bottom-right" richColors closeButton duration={4000} />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
