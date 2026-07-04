import { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors";

// Central error handler: converts thrown errors into a consistent JSON shape.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Route not found" });
}
