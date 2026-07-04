import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";

// Multi-tenant guard: every scoped request must carry a valid X-Org-Id header.
// Validates the org exists and pins req.orgId for downstream handlers.
export async function orgScope(req: Request, _res: Response, next: NextFunction) {
  const orgId = req.header("x-org-id");
  if (!orgId) {
    throw new ApiError(400, "Missing X-Org-Id header");
  }
  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  if (!org) {
    throw new ApiError(400, "Unknown organisation");
  }
  req.orgId = org.id;
  next();
}
