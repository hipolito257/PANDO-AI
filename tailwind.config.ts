import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        orange:   "#ff682c",
        carbon:   "#202020",
        graphite: "#4d4d4d",
        slate:    "#828282",
        fog:      "#f5f5f5",
        mist:     "#efefef",
        chalk:    "#e8e8e8",
        paper:    "#ffffff",
        // semantic aliases
        brand:    "#ff682c",
        ink:      "#202020",
      },
      fontFamily: {
        poly:  ["'Space Grotesk'", "ui-sans-serif", "system-ui", "sans-serif"],
        inter: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "8px",
        btn:  "20px",
        nav:  "200px",
        tag:  "20px",
      },
      boxShadow: {
        card:  "0 1px 3px rgba(32,32,32,.04), 0 4px 12px rgba(32,32,32,.03)",
        float: "0 4px 20px rgba(32,32,32,.08), 0 1px 4px rgba(32,32,32,.05)",
      },
      letterSpacing: {
        tight: "-0.02em",
        tighter: "-0.03em",
      },
    },
  },
  plugins: [],
};

export default config;
