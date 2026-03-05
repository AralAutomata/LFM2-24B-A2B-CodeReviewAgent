import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        severity: {
          critical: '#ef4444',
          high: '#f97316',
          medium: '#eab308',
          low: '#3b82f6',
          info: '#6b7280',
        },
        category: {
          bug: '#ef4444',
          security: '#f97316',
          style: '#eab308',
          performance: '#22c55e',
          test_coverage: '#3b82f6',
          dead_code: '#6b7280',
          type_safety: '#8b5cf6',
          documentation: '#06b6d4',
          complexity: '#ec4899',
          dependency: '#f59e0b',
          error_handling: '#14b8a6',
        },
      },
    },
  },
  plugins: [],
}
export default config
