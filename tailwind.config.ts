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
        orange:   "#004F46",  // PANDO dark forest green — replaces orange as primary accent
        carbon:   "#0A231F",  // PANDO near-black (NKB)
        graphite: "#42533E",  // PANDO dark olive green
        slate:    "#6B7B6B",  // muted green-gray for secondary text
        fog:      "#EEF1EC",  // very light gray-green background
        mist:     "#E5EAE5",  // light gray-green page background
        chalk:    "#D9DBD4",  // PANDO GRG — borders and dividers
        paper:    "#FFFFFF",
        // semantic aliases
        brand:    "#004F46",  // PANDO dark forest green
        ink:      "#0A231F",
        forest:   "#004F46",  // explicit alias
        green:    "#437742",  // PANDO medium green (MDG)
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
        card:  "0 1px 3px rgba(10,35,31,.04), 0 4px 12px rgba(10,35,31,.03)",
        float: "0 4px 20px rgba(10,35,31,.08), 0 1px 4px rgba(10,35,31,.05)",
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
