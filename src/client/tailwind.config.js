/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
        surface: {
          950: "#08090d",
          900: "#0c0d14",
          850: "#10111a",
          800: "#151620",
          750: "#1a1c28",
          700: "#222436",
          650: "#2a2d42",
          600: "#363a52",
          500: "#4a4f6a",
          400: "#6b7094",
          300: "#9298b5",
          200: "#b8bdd6",
          100: "#dfe2ee",
        },
        danger: {
          400: "#fb7185",
          500: "#f43f5e",
          600: "#e11d48",
        },
        success: {
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
        },
      },
      fontFamily: {
        display: ["Outfit", "system-ui", "sans-serif"],
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.35s ease-out",
        "slide-down": "slideDown 0.3s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
        "toast-in": "toastIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "toast-out": "toastOut 0.3s ease-in forwards",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideDown: {
          "0%": { transform: "translateY(-8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        toastIn: {
          "0%": { transform: "translateX(100%) scale(0.95)", opacity: "0" },
          "100%": { transform: "translateX(0) scale(1)", opacity: "1" },
        },
        toastOut: {
          "0%": { transform: "translateX(0) scale(1)", opacity: "1" },
          "100%": { transform: "translateX(100%) scale(0.95)", opacity: "0" },
        },
      },
      boxShadow: {
        glow: "0 0 20px -5px rgba(245, 158, 11, 0.15)",
        "glow-lg": "0 0 30px -5px rgba(245, 158, 11, 0.2)",
        card: "0 1px 3px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.15)",
        "card-hover":
          "0 4px 16px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.2)",
        modal: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(34,36,54,0.8)",
      },
    },
  },
  plugins: [],
};
