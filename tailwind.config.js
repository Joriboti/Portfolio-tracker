/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef9f5",
          100: "#d6f1e5",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          900: "#064e3b",
        },
      },
    },
  },
  plugins: [],
};
