import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/api';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/toast';
import { getTheme, applyTheme } from '@/lib/theme';
import { App } from '@/App';
import './index.css';

applyTheme(getTheme()); // set dark/light before first paint

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
