import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    // Use esbuild for faster builds (better than terser for development)
    // Terser provides better compression but is slower
    minify: 'esbuild', // Switch to 'terser' for production if needed for better compression
    // terserOptions: {
    //   compress: {
    //     drop_console: true,
    //     drop_debugger: true,
    //   },
    // },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Split node_modules into separate chunks
          if (id.includes('node_modules')) {
            // Split React and React-DOM into separate chunk
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            // Split react-virtuoso into separate chunk (heavy library)
            if (id.includes('react-virtuoso')) {
              return 'vendor-virtuoso';
            }
            // Other vendor libraries
            return 'vendor';
          }
          // Split large components into separate chunks
          if (id.includes('TradingDashboard')) {
            return 'component-dashboard';
          }
          if (id.includes('PnLSection') || id.includes('OrdersSection')) {
            return 'component-trading';
          }
          if (id.includes('FloatListsSection') || id.includes('FloatRawListsSection')) {
            return 'component-float';
          }
        },
        // Optimize chunk file names
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
    // Enable CSS code splitting
    cssCodeSplit: true,
  },
  server: {
    port: 5173,
    host: true
  },
  base: '/',
  preview: {
    port: 5173,
    host: true
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: [], // Remove exclude to prevent lazy loading issues in dev
  },
})
