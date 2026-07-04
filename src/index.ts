import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";

import { env } from "./lib/env";
import { initSocket } from "./lib/socket";
import { organisationsRouter } from "./routes/organisations";
import { contractsRouter } from "./routes/contracts";
import { attachmentsRouter } from "./routes/attachments";
import { openapiSpec } from "./docs/openapi";
import { errorHandler, notFoundHandler } from "./middleware/error";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",") }));
  app.use(express.json({ limit: "5mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/organisations", organisationsRouter);
  // Attachments mounted before contracts so the nested :id param resolves first.
  app.use("/api/contracts/:id/attachments", attachmentsRouter);
  app.use("/api/contracts", contractsRouter);

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Only start the server when run directly (tests import createApp instead).
if (require.main === module) {
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  server.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
    console.log(`API docs at http://localhost:${env.port}/api/docs`);
  });
}
