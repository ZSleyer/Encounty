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
        // Counter trigger animations
        'overlay-pop':      'overlay-pop 0.3s ease-out',
        'overlay-flash':    'overlay-flash 0.45s ease-out',
        'overlay-bounce':   'overlay-bounce 0.5s ease-out',
        'overlay-shake':    'overlay-shake 0.4s ease-out',
        'overlay-slide-up': 'overlay-slide-up 0.3s ease-out',
        'overlay-flip':     'overlay-flip 0.45s ease-in-out',
        'overlay-rubber':   'overlay-rubber 0.55s ease-out',
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
        // Counter trigger keyframes
        'overlay-pop': {
          '0%':   { transform: 'scale(1)' },
          '50%':  { transform: 'scale(1.45)' },
          '100%': { transform: 'scale(1)' },
        },
        'overlay-flash': {
          '0%, 100%': { filter: 'brightness(1)' },
          '50%':      { filter: 'brightness(2.5) drop-shadow(0 0 12px rgba(255,230,80,0.9))' },
        },
        'overlay-bounce': {
          '0%':   { transform: 'translateY(0)' },
          '25%':  { transform: 'translateY(-22px)' },
          '50%':  { transform: 'translateY(0)' },
          '68%':  { transform: 'translateY(-10px)' },
          '82%':  { transform: 'translateY(0)' },
          '91%':  { transform: 'translateY(-4px)' },
          '100%': { transform: 'translateY(0)' },
        },
        'overlay-shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '15%':      { transform: 'translateX(-9px)' },
          '30%':      { transform: 'translateX(9px)' },
          '45%':      { transform: 'translateX(-6px)' },
          '60%':      { transform: 'translateX(6px)' },
          '75%':      { transform: 'translateX(-3px)' },
          '90%':      { transform: 'translateX(3px)' },
        },
        'overlay-slide-up': {
          '0%':   { transform: 'translateY(40px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        // Flip-clock / split-flap: top half folds away, new number folds in
        'overlay-flip': {
          '0%':   { transform: 'perspective(300px) rotateX(0deg)',   opacity: '1' },
          '42%':  { transform: 'perspective(300px) rotateX(-92deg)', opacity: '0' },
          '58%':  { transform: 'perspective(300px) rotateX(92deg)',  opacity: '0' },
          '100%': { transform: 'perspective(300px) rotateX(0deg)',   opacity: '1' },
        },
        'overlay-rubber': {
          '0%':   { transform: 'scaleX(1)    scaleY(1)' },
          '28%':  { transform: 'scaleX(1.42) scaleY(0.62)' },
          '48%':  { transform: 'scaleX(0.80) scaleY(1.18)' },
          '68%':  { transform: 'scaleX(1.12) scaleY(0.9)' },
          '84%':  { transform: 'scaleX(0.96) scaleY(1.04)' },
          '100%': { transform: 'scaleX(1)    scaleY(1)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
