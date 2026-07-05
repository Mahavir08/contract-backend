import { Router } from "express";
import { organisationsController } from "../controllers/organisations.controller";

export const organisationsRouter = Router();

organisationsRouter.get("/", organisationsController.list);
organisationsRouter.post("/", organisationsController.create);
