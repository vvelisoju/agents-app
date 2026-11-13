import type { Config } from 'tailwindcss';

// Two-layer tokens (ClassPe pattern): HSL color vars in index.css consumed here,
// plus named spacing/size tokens (safe-area, tap target, app chrome).
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        accent: 'hsl(var(--accent))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        good: 'hsl(var(--good))',
        warn: 'hsl(var(--warn))',
        destructive: 'hsl(var(--destructive))',
      },
      borderRadius: { lg: '0.75rem', md: '0.5rem', sm: '0.375rem' },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        gutter: '1rem',
        appbar: '3.5rem',
        tabbar: '4rem',
      },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
      fontFamily: { sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
