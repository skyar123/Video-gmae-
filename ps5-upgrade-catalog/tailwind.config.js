/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      transitionTimingFunction: {
        // Slight overshoot: the "bounce" in the scroll and control animations.
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        swift: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        popIn: {
          from: { opacity: '0', transform: 'scale(0.95) translateY(8px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(14px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        sheetDown: {
          from: { opacity: '0', transform: 'translateY(-10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 160ms ease-out',
        'pop-in': 'popIn 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'rise-in': 'riseIn 340ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'slide-in': 'slideIn 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheet-down': 'sheetDown 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
