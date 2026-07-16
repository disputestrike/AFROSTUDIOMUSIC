import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0B12',
        // deep night background scale
        night: {
          950: '#070710',
          900: '#0B0B16',
          800: '#12121F',
          700: '#1A1A2B',
        },
        afrobrand: {
          50: '#FFF7ED',
          100: '#FFEDD5',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C',
          900: '#7C2D12',
        },
        gold: '#F5B942',
        magenta: '#E23E8C',
        sage: '#5BA889',
        wine: '#7A1F39',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Anton', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        grotesk: ['var(--font-grotesk)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(249,115,22,.25), 0 8px 40px -8px rgba(249,115,22,.45)',
        'glow-magenta': '0 0 0 1px rgba(226,62,140,.25), 0 8px 40px -8px rgba(226,62,140,.4)',
        card: '0 10px 40px -12px rgba(0,0,0,.7)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(100deg,#F5B942 0%,#F97316 40%,#E23E8C 100%)',
      },
      keyframes: {
        drift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(2%,-3%,0) scale(1.08)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        eq: {
          '0%,100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        drift: 'drift 22s ease-in-out infinite',
        'drift-slow': 'drift 34s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        shimmer: 'shimmer 3s linear infinite',
        eq: 'eq 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
