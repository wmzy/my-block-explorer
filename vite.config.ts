import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wyw from "@wyw-in-js/vite";
import path from "path";
import type { Plugin } from "vite";

// Custom plugin to integrate Hono API app
function honoApiPlugin(): Plugin {
  return {
    name: "hono-api",
    configureServer(server) {
      server.middlewares.use("/api", async (req, res, next) => {
        try {
          // Dynamically import the API app to support HMR
          const { default: apiApp } = await import("./src/api-app");

          // Convert Node.js request to Hono request
          // Restore the full path including /api prefix
          const fullPath = "/api" + (req.url || "");
          const url = new URL(fullPath, `http://${req.headers.host}`);

          // Handle request body for POST/PUT/PATCH requests
          let body: string | undefined = undefined;
          if (req.method !== "GET" && req.method !== "HEAD") {
            body = await new Promise<string>((resolve, reject) => {
              let data = "";
              req.on("data", (chunk) => {
                data += chunk;
              });
              req.on("end", () => {
                resolve(data);
              });
              req.on("error", reject);
            });
          }

          const request = new Request(url.toString(), {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: body,
          });

          // Get response from Hono app
          const response = await apiApp.fetch(request);

          // Convert Hono response to Node.js response
          res.statusCode = response.status;

          // Set headers
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          // Send body
          const responseBody = await response.text();
          res.end(responseBody);
        } catch (error) {
          console.error("API Error:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react({
      // 启用React 19的新特性
      babel: {
        plugins: [
          ["@babel/plugin-transform-react-jsx", { runtime: "automatic" }],
        ],
      },
    }),
    wyw({
      sourceMap: process.env.NODE_ENV !== "production",
      displayName: process.env.NODE_ENV !== "production",
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      include: ["**/*.{ts,tsx}"],
      evaluate: true,
      babelOptions: {
        presets: ["@babel/preset-typescript", "@babel/preset-react"],
      },
    }),
    honoApiPlugin(),
  ],
  root: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "./dist/client",
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) return "vendor";
          if (id.includes("node_modules/react-router")) return "router";
          if (id.includes("node_modules/echarts")) return "charts";
        },
      },
    },
  },
  server: {
    port: parseInt(process.env.PORT || "3000"),
    host: true,
  },
  publicDir: path.resolve(__dirname, "public"),
  // 支持服务端渲染和API路由
  ssr: {
    noExternal: ["hono"],
  },
});
