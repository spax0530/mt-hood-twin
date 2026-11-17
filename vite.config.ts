import { defineConfig } from 'vite';
// Relative base so the site works at any GitHub Pages path.
// __BUILD__ is stamped into data URLs so a new deploy is never masked by cached data files.
export default defineConfig({ base: './', build: { target: 'es2022' }, define: { __BUILD__: JSON.stringify(String(Date.now())) } });
