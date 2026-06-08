/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
      },
      colors: {
        terminal: {
          bg: "#0a0b0d",
          card: "#0f1117",
          border: "#1e2030",
          hover: "#161822",
          green: "#00d084",
          red: "#ff4757",
          yellow: "#ffa726",
          blue: "#40c4ff",
          purple: "#b388ff",
          gray: "#4a5568",
          text: "#c9d1d9",
          muted: "#636e7b",
        },
      },
    },
  },
  plugins: [],
};
