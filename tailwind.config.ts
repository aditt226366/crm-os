import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#030712",
        foreground: "#f8fafc",
        border: "rgba(255,255,255,0.10)",
        muted: "#94a3b8",
        cyanGlow: "#22d3ee",
        blueGlow: "#2563eb",
        wa: {
          green: "#25D366",
          greenDark: "#1da851",
          teal: "#128C7E",
          accent: "#0a7c3e",
          ink: "#080d0b",
          panel: "#101815",
          line: "rgba(255,255,255,0.08)"
        }
      },
      boxShadow: {
        glow: "0 0 48px rgba(34, 211, 238, 0.22)",
        "glow-strong": "0 0 88px rgba(37, 99, 235, 0.34)"
      },
      fontFamily: {
        sans: [
          "Inter",
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ]
      },
      keyframes: {
        borderFlow: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" }
        },
        pulseLine: {
          "0%, 100%": { opacity: "0.34", transform: "scaleX(0.74)" },
          "50%": { opacity: "1", transform: "scaleX(1)" }
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" }
        }
      },
      animation: {
        borderFlow: "borderFlow 6s linear infinite",
        pulseLine: "pulseLine 3.8s ease-in-out infinite",
        shimmer: "shimmer 3s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
