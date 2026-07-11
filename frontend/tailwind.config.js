/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: 'var(--void)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        raised: 'var(--raised)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        brand: {
          DEFAULT: 'var(--brand)',
          lit: 'var(--brand-lit)',
          deep: 'var(--brand-deep)',
        },
        gold: {
          DEFAULT: 'var(--gold)',
          lit: 'var(--gold-lit)',
        },
        good: 'var(--good)',
        crit: 'var(--crit)',
        bg: 'var(--void)',
        card: 'var(--panel)',
        border: 'var(--line-2)',
        accent: 'var(--brand)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        display: ['var(--text-display)', { lineHeight: 'var(--leading-display)' }],
        heading: ['var(--text-heading)', { lineHeight: 'var(--leading-heading)' }],
        body: ['var(--text-body)', { lineHeight: 'var(--leading-body)' }],
      },
      borderRadius: {
        instrument: '8px',
      },
    },
  },
  plugins: []
}
