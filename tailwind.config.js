/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: update these globs whenever new top-level source folders are added.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Dibs brand palette — white base, purple accent.
        cream: "#FFFFFF",
        ink: "#1A1A1A",
        coral: {
          DEFAULT: "#9013BB",
          dark: "#3A0A57",
          soft: "#E5BCEC",
        },
        sand: "#F5F5F5",
        muted: "#888888",
        line: "#E5E5E5",
        // Surface tokens (light theme)
        pitch: "#1A1A1A",
        surface: "#F5F5F5",
        dim: "#888888",
      },
      fontFamily: {
        sans: ["System"],
      },
      borderRadius: {
        card: "20px",
      },
    },
  },
  plugins: [],
};
