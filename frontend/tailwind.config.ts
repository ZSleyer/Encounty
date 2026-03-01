import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f0f13',
          secondary: '#1a1a24',
          card: '#1e1e2e',
          hover: '#252535',
        },
        accent: {
          red: '#e64040',
          blue: '#4a9eff',
          yellow: '#ffd700',
          green: '#4ade80',
          purple: '#a855f7',
        },
        border: {
          subtle: '#2a2a3a',
          active: '#4a9eff',
        },
      },
      animation: {
        'flash': 'flash 0.4s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
        'float': 'float 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'count-flash': 'count-flash 0.4s ease-out',
        'overlay-fade-in': 'overlay-fade-in 0.4s ease-out',
        'overlay-slide-in': 'overlay-slide-in 0.3s ease-out',
      },
      keyframes: {
        flash: {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(74, 158, 255, 0.3)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        'count-flash': {
          '0%': { transform: 'scale(1)', color: 'inherit' },
          '50%': { transform: 'scale(1.3)', color: '#60a5fa' },
          '100%': { transform: 'scale(1)' },
        },
        'overlay-fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'overlay-slide-in': {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
