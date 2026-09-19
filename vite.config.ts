import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages project sites are served from /<repo-name>/, not the domain
  // root. Set this to match your repo name exactly (with leading/trailing
  // slashes). If you ever move to a custom domain or user/org page
  // (username.github.io), change this back to '/'.
  base: '/Offline-I-O-SCADA-Loop-Validator/',
  plugins: [react()],
  server: {
    host: true, // expose on LAN so you can test on a phone against a dev PLC network
  },
  build: {
    sourcemap: true,
  },
});
