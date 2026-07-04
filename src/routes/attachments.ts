import { Router } from "express";
import multer from "multer";
import { orgScope } from "../middleware/orgScope";
import { badRequest, notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getContract } from "../services/contracts";
import { storage } from "../lib/storage";

// Params merged in from the parent mount (/api/contracts/:id/attachments).
type Params = { id: string; attachmentId: string };

// Attachments are org-scoped and mounted under /api/contracts/:id/attachments.
export const attachmentsRouter = Router({ mergeParams: true });

attachmentsRouter.use(orgScope);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// GET list of attachments for a contract
attachmentsRouter.get("/", async (req, res) => {
  await getContract(req.orgId!, (req.params as Params).id);
  const items = await prisma.attachment.findMany({
    where: { orgId: req.orgId!, contractId: (req.params as Params).id },
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
});

// POST a PDF attachment (multipart form field: "file")
attachmentsRouter.post("/", upload.single("file"), async (req, res) => {
  await getContract(req.orgId!, (req.params as Params).id);
  const file = req.file;
  if (!file) throw badRequest("Missing file (form field 'file')");
  if (file.mimetype !== "application/pdf") throw badRequest("Only PDF files are allowed");

  const stored = await storage.save(req.orgId!, (req.params as Params).id, file.originalname, file.mimetype, file.buffer);
  const attachment = await prisma.attachment.create({
    data: {
      orgId: req.orgId!,
      contractId: (req.params as Params).id,
      fileName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      storageKey: stored.storageKey,
    },
  });
  res.status(201).json(attachment);
});

// GET download a specific attachment
attachmentsRouter.get("/:attachmentId/download", async (req, res) => {
  const attachment = await prisma.attachment.findFirst({
    where: { id: (req.params as Params).attachmentId, orgId: req.orgId!, contractId: (req.params as Params).id },
  });
  if (!attachment) throw notFound("Attachment not found");
  const buffer = await storage.read(attachment.storageKey);
  res.setHeader("Content-Type", attachment.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName}"`);
  res.send(buffer);
});
