/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        // Rounded display sans for headings — the brand's Capstone-style voice.
        display: ['"Fredoka"', "ui-rounded", '"Segoe UI"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(122,86,32,0.05), 0 18px 42px -24px rgba(122,86,32,0.30)",
        "card-hover":
          "0 1px 2px rgba(122,86,32,0.06), 0 26px 50px -24px rgba(209,85,15,0.28)",
      },
      colors: {
        // TrimmTrack — burnt-amber palette inspired by the orange of Blur's "13"
        brand: {
          50: "#fff7ed",
          100: "#fde8d3",
          200: "#facfa6",
          300: "#f5ac6e",
          400: "#ef8540",
          500: "#e76b1c",
          600: "#d1550f",
          700: "#a9410f",
          800: "#853513",
          900: "#4e2310",
        },
      },
    },
  },
  plugins: [],
};
