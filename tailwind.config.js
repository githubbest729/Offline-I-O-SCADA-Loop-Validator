/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // High-contrast palette tuned for direct sunlight / factory-floor
        // readability, keeping status colors unambiguous even for
        // color-vision-deficient users (paired with icons, never color alone).
      },
    },
  },
  plugins: [],
};
