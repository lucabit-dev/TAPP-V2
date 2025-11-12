/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      gridTemplateColumns: {
        '13': 'repeat(13, minmax(0, 1fr))',
        '24': 'repeat(24, minmax(0, 1fr))',
      },
      colors: {
        'success': '#10b981',
        'warning': '#f59e0b',
        'danger': '#ef4444',
        'trading-bg': '#111827',
        'trading-card': '#1f2937',
        'trading-border': '#374151',
      },
      fontFamily: {
        'sans': ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}