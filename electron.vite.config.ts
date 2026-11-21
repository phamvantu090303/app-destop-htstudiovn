import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const DEFAULT_API_URL = 'http://localhost:4000/api';

export default defineConfig(({ mode }) => {
  // Only VITE_* variables from .env are read (see .env.example).
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    main: {
      // The main process needs the API origin to fix CORS for the desktop origin (see src/main/cors.ts).
      define: {
        __API_URL__: JSON.stringify(env.VITE_API_URL || DEFAULT_API_URL),
      },
    },
    preload: {},
    renderer: {
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src/renderer/src'),
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
      // The Studio code ported from the web app reads `process.env.NODE_ENV`; there is no
      // `process` in the sandboxed renderer, so replace it at build time (dev and prod).
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      },
    },
  };
});
