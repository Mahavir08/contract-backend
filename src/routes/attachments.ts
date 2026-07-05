import { Router } from "express";
import multer from "multer";
import { orgScope } from "../middleware/orgScope";
import { attachmentsController } from "../controllers/attachments.controller";

// Attachments are org-scoped and mounted under /api/contracts/:id/attachments.
export const attachmentsRouter = Router({ mergeParams: true });

attachmentsRouter.use(orgScope);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

attachmentsRouter.get("/", attachmentsController.list);
attachmentsRouter.post("/", upload.single("file"), attachmentsController.create);
attachmentsRouter.delete("/:attachmentId", attachmentsController.remove);
attachmentsRouter.get("/:attachmentId/download", attachmentsController.download);
