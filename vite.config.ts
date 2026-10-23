import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveEnvironment } from './src/environment';
import { injectBrowserSecurity } from './src/browser-security';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const appConfig = resolveEnvironment({ ...env, MODE: mode });
  const buildHash = env.GITHUB_SHA || 'dev';

  return {
    base: '/chatbot-gastos/',
    plugins: [
      react(),
      {
        name: 'pesito-browser-security',
        // HMR de desarrollo necesita su propio entorno; nunca relajar el artefacto publicado.
        apply: 'build',
        transformIndexHtml: {
          order: 'post',
          handler: (html) => injectBrowserSecurity(html, appConfig.supabaseUrl),
        },
      },
    ],
    define: {
      __APP_CONFIG__: JSON.stringify(appConfig),
      __BUILD_HASH__: JSON.stringify(buildHash),
    },
  };
});
