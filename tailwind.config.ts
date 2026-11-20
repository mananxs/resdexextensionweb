import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        pop: { from: { opacity: "0", transform: "translateY(12px) scale(.98)" }, to: { opacity: "1", transform: "none" } },
        slide: { from: { transform: "translateX(100%)" }, to: { transform: "none" } },
      },
      animation: {
        fade: "fade .2s ease-out",
        pop: "pop .25s cubic-bezier(.2,.8,.2,1)",
        slide: "slide .28s cubic-bezier(.2,.8,.2,1)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
