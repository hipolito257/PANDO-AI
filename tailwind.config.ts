import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Palette and type of the Pando website (pando-web): deep olive, pistachio
      // accent, sage secondary text, warm paper background, square corners and
      // hairline borders instead of shadows.
      colors: {
        orange:   "#0F2D2B",  // primary accent (historic name) = Pando olive
        carbon:   "#0A231F",  // near-black text
        graphite: "#3E4F47",  // body text
        slate:    "#6F7E68",  // secondary text (sage, darkened for legibility)
        fog:      "#EFEFE8",  // subtle fills
        mist:     "#F5F5F0",  // page background (website "paper")
        chalk:    "#D9DBD4",  // borders and dividers (website "grey")
        paper:    "#FFFFFF",  // cards
        // semantic aliases
        brand:    "#0F2D2B",
        ink:      "#0A231F",
        forest:   "#0F2D2B",
        olive:    "#0F2D2B",
        pistacho: "#DCE9C2",  // website accent
        sage:     "#8A9982",
        green:    "#437742",
      },
      fontFamily: {
        sans:    ["'Work Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Josefin Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        poly:    ["'Josefin Sans'", "ui-sans-serif", "system-ui", "sans-serif"],  // headings / big numbers
        inter:   ["'Work Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "2px",
        btn:  "0px",
        nav:  "0px",
        tag:  "2px",
      },
      boxShadow: {
        card:  "0 0 0 1px rgba(15,45,43,.08)",
        float: "0 0 0 1px rgba(15,45,43,.08), 0 12px 32px rgba(15,45,43,.10)",
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
