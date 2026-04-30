import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: "#1f2937",
        signal: "#0f766e",
        aperture: "#2563eb",
        substrate: "#f7f7f4"
      }
    }
  },
  plugins: []
} satisfies Config;

