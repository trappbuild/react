import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'

// Nothing from these packages is bundled; React and rrweb come from the host app.
export const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', 'rrweb']

// The SDK runs on every page of every client, including old WebViews (Telegram on Android 8+) and
// iOS 14–15. Without an explicit target Vite emits `??=`, `?.`-heavy ES2021+ and CSS range media
// queries (`width<=720px`) that those engines reject — one SyntaxError and the whole module is gone.
export const TARGET = ['es2019', 'safari14', 'chrome80', 'firefox78']
export const CSS_TARGET = ['safari14', 'chrome80', 'firefox78']

/**
 * Four independent builds (see package.json "build"):
 *   default  → dist/index.js + index.cjs   React entry, "use client"
 *   server   → dist/server.js + server.cjs no React, no browser globals
 *   browser  → dist/browser.js + browser.cjs no React
 *   guard    → dist/guard.min.js           minified IIFE for <head>
 */
export default defineConfig(({ mode }): UserConfig => {
  if (mode === 'guard') {
    return {
      build: {
        target: TARGET,
        emptyOutDir: false,
        minify: true,
        lib: {
          entry: 'src/guard/guard.js',
          formats: ['iife'],
          name: '__trappGuard',
          fileName: () => 'guard.min.js',
        },
        sourcemap: false,
      },
    }
  }

  const entry = mode === 'server' ? 'server' : mode === 'browser' ? 'browser' : 'index'
  const client = entry === 'index'

  return {
    plugins: client ? [react()] : [],
    build: {
      target: TARGET,
      cssTarget: CSS_TARGET,
      emptyOutDir: client,
      lib: {
        entry: `src/${entry}.ts`,
        formats: ['es', 'cjs'],
        fileName: (format) => `${entry}.${format === 'es' ? 'js' : 'cjs'}`,
      },
      rolldownOptions: {
        external: EXTERNAL,
        // Hooks and context belong to a client module; the other entries do not.
        output: { banner: client ? '"use client";' : '' },
      },
      sourcemap: true,
    },
  }
})
