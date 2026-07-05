import { Router } from "express";
import { orgScope } from "../middleware/orgScope";
import { contractsController } from "../controllers/contracts.controller";

export const contractsRouter = Router();

// All contract routes are organisation-scoped.
contractsRouter.use(orgScope);

contractsRouter.get("/", contractsController.list);
contractsRouter.post("/", contractsController.create);
contractsRouter.get("/:id", contractsController.get);
contractsRouter.patch("/:id", contractsController.update);
contractsRouter.post("/:id/finalize", contractsController.finalize);
contractsRouter.post("/:id/archive", contractsController.archive);
contractsRouter.delete("/:id", contractsController.remove);
contractsRouter.get("/:id/events", contractsController.events);
