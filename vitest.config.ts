import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["node_modules", "dist", "build"],
    testTimeout: 30000, // 30秒超时，适合网络请求
    hookTimeout: 30000,
    teardownTimeout: 30000,
    setupFiles: ["src/tests/setup.ts"],
    // 测试覆盖率配置
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/tests/**",
        "src/**/*.d.ts",
        "src/test-*.ts", // 排除旧的测试脚本
        "src/rpc-test.ts",
        "src/simple-test.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
