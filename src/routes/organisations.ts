import { Router } from "express";
import { badRequest } from "../lib/errors";
import { toFieldErrors } from "../schemas/contract";
import { createOrganisationSchema } from "../schemas/organisation";
import { createOrganisation, listOrganisations } from "../services/organisations";

export const organisationsRouter = Router();

// GET /api/organisations — list orgs for the tenant selector (not org-scoped).
organisationsRouter.get("/", async (_req, res) => {
  res.json(await listOrganisations());
});

// POST /api/organisations — create a new organisation.
organisationsRouter.post("/", async (req, res) => {
  const parsed = createOrganisationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Organisation validation failed", toFieldErrors(parsed.error));
  }
  const org = await createOrganisation(parsed.data);
  res.status(201).json(org);
});
