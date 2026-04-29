import sqPreset from '../rae-side-quest/packages/sq-ui/tailwind-preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [sqPreset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../rae-side-quest/packages/sq-ui/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // Keep `rungles` palette as an alias for the canonical wordy purple
      // so existing rungles-* classes continue to work without a mass rename.
      // Identical hex values — visual outcome is uniform.
      colors: {
        rungles: {
          50:  '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
        },
      },
    },
  },
};
