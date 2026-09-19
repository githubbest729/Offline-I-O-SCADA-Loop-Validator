import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose on LAN so you can test on a phone against a dev PLC network
  },
  build: {
    sourcemap: true,
  },
});
