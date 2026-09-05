import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const buildHash = env.GITHUB_SHA || 'dev';

  return {
    base: '/chatbot-gastos/',
    plugins: [react()],
    define: {
      __BUILD_HASH__: JSON.stringify(buildHash),
    },
  };
});
