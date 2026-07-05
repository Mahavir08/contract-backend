import { Request, Response } from "express";
import { badRequest } from "../lib/errors";
import { toFieldErrors } from "../schemas/contract";
import { createOrganisationSchema } from "../schemas/organisation";
import { createOrganisation, listOrganisations } from "../services/organisations";

// Controller: translates HTTP <-> the organisations service.
export const organisationsController = {
  // GET /api/organisations — list orgs for the tenant selector (not org-scoped).
  async list(_req: Request, res: Response) {
    res.json(await listOrganisations());
  },

  // POST /api/organisations — create a new organisation.
  async create(req: Request, res: Response) {
    const parsed = createOrganisationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Organisation validation failed", toFieldErrors(parsed.error));
    }
    const org = await createOrganisation(parsed.data);
    res.status(201).json(org);
  },
};
