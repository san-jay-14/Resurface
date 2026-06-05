/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: update these globs whenever new top-level source folders are added.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Warm, Gen-Z palette. Personality lives in copy; UI stays clean + warm.
        cream: "#FFF8F2",
        ink: "#1C1714",
        coral: {
          DEFAULT: "#FF6B4A",
          dark: "#E8553A",
          soft: "#FFE7E0",
        },
        sand: "#EFE6DC",
        muted: "#8A7E74",
        line: "#E7DBCF",
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
