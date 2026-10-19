import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['facilita.svg'],
      manifest: {
        name: 'Facilita | Validade',
        short_name: 'Facilita',
        description: 'Protótipo de conferência de validade',
        theme_color: '#f4f3ed',
        background_color: '#f4f3ed',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/facilita.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
})
