import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveEnvironment } from './src/environment';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const appConfig = resolveEnvironment({ ...env, MODE: mode });
  const buildHash = env.GITHUB_SHA || 'dev';

  return {
    base: '/chatbot-gastos/',
    plugins: [react()],
    define: {
      __APP_CONFIG__: JSON.stringify(appConfig),
      __BUILD_HASH__: JSON.stringify(buildHash),
    },
  };
});
