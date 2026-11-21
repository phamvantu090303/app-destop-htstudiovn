import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './globals.css';
import App from './App';
import { AuthProvider } from '@/contexts/auth-context';
import { AppToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getStoredTheme } from '@/lib/theme';

// Same job as the web app's inline THEME_INIT_SCRIPT (blocked here by the CSP): apply the saved
// light theme before the first paint to avoid a dark→light flash.
if (getStoredTheme() === 'light') {
  document.documentElement.classList.add('light');
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <AppToastProvider>
      <TooltipProvider delay={100}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </TooltipProvider>
    </AppToastProvider>
  </StrictMode>,
);
