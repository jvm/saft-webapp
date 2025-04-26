import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/saft-webapp/', // Set base for GitHub Pages deployment
  plugins: [react()],
});
