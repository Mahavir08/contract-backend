import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 moves the migration/connection URL out of schema.prisma into this file.
// The runtime client connects via a driver adapter (see src/lib/prisma.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
