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
        // Warm neutral — overrides Tailwind's cool blue-gray `slate` app-wide so
        // every hardcoded bg-slate-*/text-slate-*/border-slate-* across the 30+
        // internal components picks up the warm, branded ground in one place
        // (a taupe with a slight amber bias — a chosen neutral, not cool default).
        slate: {
          50: "#f7f3ec",
          100: "#efe9df",
          200: "#e5ddce",
          300: "#d3c9b7",
          400: "#a99e8b",
          500: "#847a6a",
          600: "#655c4e",
          700: "#4b4336",
          800: "#332d22",
          900: "#221d15",
        },
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
