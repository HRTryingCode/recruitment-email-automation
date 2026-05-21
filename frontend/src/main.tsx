import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { TooltipProvider } from './components/ui/tooltip';
import {
  applyTheme,
  getInitialTheme,
  subscribeToTheme,
  type Theme,
} from './lib/theme';
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

function ThemedToaster() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  useEffect(() => subscribeToTheme(setTheme), []);
  return (
    <Toaster
      position="bottom-right"
      theme={theme}
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        className: 'sonner-toast',
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider>
          <App />
        </TooltipProvider>
        <ThemedToaster />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
