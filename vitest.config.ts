import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Point the app's Prisma client at an isolated test database.
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/contracts_test?schema=public",
      CORS_ORIGIN: "*",
      STORAGE_DRIVER: "local",
    },
    fileParallelism: false,
    hookTimeout: 30000,
  },
});
