import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1c1915",
        paper: "#f7f3ea",
        card: "#fffdf8",
        line: "#e3d9c8",
        saffron: "#d4652f",
        moss: "#1e6b45",
        clay: "#8c3a32",
      },
    },
  },
  plugins: [],
};

export default config;
