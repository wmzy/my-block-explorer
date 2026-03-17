import { describe, it, expect } from "vitest";
import app from "@/api-app";

describe("API routes", () => {
  describe("GET /api", () => {
    it("returns API info", async () => {
      const response = await app.request("/api", { method: "GET" });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toMatchObject({
        name: "Block Explorer API",
        version: "1.0.0",
        description: "A modern blockchain explorer API",
      });
      expect(data).toHaveProperty("endpoints");
      expect(data).toHaveProperty("timestamp");
    });
  });

  describe("GET /api/health", () => {
    it("returns healthy status", async () => {
      const response = await app.request("/api/health", { method: "GET" });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toMatchObject({
        status: "healthy",
        message: "Block Explorer API is running",
        version: "1.0.0",
      });
      expect(data).toHaveProperty("timestamp");
    });
  });

  describe("GET /nonexistent", () => {
    it("returns 404 with unified error format", async () => {
      const response = await app.request("/nonexistent", { method: "GET" });

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(data).toHaveProperty("message");
      expect(data).toHaveProperty("statusCode", 404);
      expect(data).toHaveProperty("timestamp");
    });
  });
});
