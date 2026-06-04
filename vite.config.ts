import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // App version is build-derived. Bump VITE_MANIFEST_VERSION per release in the
    // hosting env; the fallback keeps the footer correct before the env var is set.
    __MANIFEST_VERSION__: JSON.stringify(process.env.VITE_MANIFEST_VERSION ?? '1.0.0.109'),
  },
})
