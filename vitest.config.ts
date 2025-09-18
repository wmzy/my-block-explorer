import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import wyw from "@wyw-in-js/vite";
import path from "path";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ["@babel/plugin-transform-react-jsx", { runtime: "automatic" }],
        ],
      },
    }),
    wyw({
      sourceMap: false,
      displayName: false,
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      include: ["**/*.{ts,tsx}"],
      evaluate: true,
      babelOptions: {
        presets: ["@babel/preset-typescript", "@babel/preset-react"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@/components": path.resolve(__dirname, "./components"),
      "@/pages": path.resolve(__dirname, "./pages"),
      "@/hooks": path.resolve(__dirname, "./hooks"),
      "@/styles": path.resolve(__dirname, "./styles"),
      "@/api": path.resolve(__dirname, "./api"),
      "@/services": path.resolve(__dirname, "./services"),
      "@/middleware": path.resolve(__dirname, "./middleware"),
      "@/routes": path.resolve(__dirname, "./routes"),
      "@/database": path.resolve(__dirname, "./database"),
      "@/types": path.resolve(__dirname, "./types"),
      "@/utils": path.resolve(__dirname, "./utils"),
      "@/config": path.resolve(__dirname, "./config"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["node_modules", "dist", "build"],
  },
});
