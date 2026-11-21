/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#D97757",
          hover: "#C56546",
          subtle: "rgba(217, 119, 87, 0.12)",
        },
        surface: {
          bg: "var(--bg-main)",
          sidebar: "var(--bg-sidebar)",
          card: "var(--bg-card)",
          elevated: "var(--bg-elevated)",
          hover: "var(--bg-hover)",
        },
        border: {
          subtle: "var(--border-color)",
          strong: "var(--border-strong)",
        },
        ink: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(38, 37, 34, 0.04), 0 4px 12px rgba(38, 37, 34, 0.04)",
        float: "0 12px 32px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08)",
      },
    },
  },
  plugins: [],
};
