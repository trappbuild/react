import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev playground: a small app that imports the SDK straight from ../src.
export default defineConfig({
  root: 'playground',
  plugins: [react()],
  server: { port: 5180 },
})
