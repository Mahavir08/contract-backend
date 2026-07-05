import { Request, Response } from "express";
import { badRequest, conflict, notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getContract } from "../services/contracts";
import { storage } from "../lib/storage";
import { emitToOrg } from "../lib/socket";

// Params merged in from the parent mount (/api/contracts/:id/attachments).
type Params = { id: string; attachmentId: string };

// Controller: translates HTTP <-> attachment persistence + blob storage.
export const attachmentsController = {
  // GET list of attachments for a contract
  async list(req: Request, res: Response) {
    const params = req.params as Params;
    await getContract(req.orgId!, params.id);
    const items = await prisma.attachment.findMany({
      where: { orgId: req.orgId!, contractId: params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(items);
  },

  // POST a PDF attachment (multipart form field: "file")
  async create(req: Request, res: Response) {
    const params = req.params as Params;
    await getContract(req.orgId!, params.id);
    const file = req.file;
    if (!file) throw badRequest("Missing file (form field 'file')");
    if (file.mimetype !== "application/pdf") throw badRequest("Only PDF files are allowed");

    const stored = await storage.save(req.orgId!, params.id, file.originalname, file.mimetype, file.buffer);
    const attachment = await prisma.attachment.create({
      data: {
        orgId: req.orgId!,
        contractId: params.id,
        fileName: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        storageKey: stored.storageKey,
      },
    });
    // Notify every tab in the org so anyone viewing this contract's detail page
    // reloads and sees the new PDF live (the detail page refetches attachments
    // on contract:updated when the id matches).
    emitToOrg(req.orgId!, "contract:updated", { id: params.id });

    res.status(201).json(attachment);
  },

  // DELETE a specific attachment (draft contracts only)
  async remove(req: Request, res: Response) {
    const params = req.params as Params;
    const contract = await getContract(req.orgId!, params.id);
    if (contract.status !== "DRAFT") {
      throw conflict("Attachments can only be deleted while the contract is a DRAFT");
    }
    const attachment = await prisma.attachment.findFirst({
      where: { id: params.attachmentId, orgId: req.orgId!, contractId: params.id },
    });
    if (!attachment) throw notFound("Attachment not found");

    await prisma.attachment.delete({ where: { id: attachment.id } });
    // Remove the stored bytes after the row so a storage hiccup can't orphan the DB.
    await storage.delete(attachment.storageKey);

    // Notify every tab in the org so anyone viewing this contract's detail page
    // reloads and sees the PDF disappear live.
    emitToOrg(req.orgId!, "contract:updated", { id: params.id });

    res.status(204).send();
  },

  // GET download a specific attachment. Pass ?inline=1 for inline preview, which
  // serves the bytes with an inline disposition and a normalised application/pdf
  // content type so browsers render it in-place instead of forcing a download.
  async download(req: Request, res: Response) {
    const params = req.params as Params;
    const attachment = await prisma.attachment.findFirst({
      where: { id: params.attachmentId, orgId: req.orgId!, contractId: params.id },
    });
    if (!attachment) throw notFound("Attachment not found");
    const buffer = await storage.read(attachment.storageKey);
    const inline = req.query.inline === "1";
    // Attachments are always PDFs; fall back to application/pdf if the stored
    // content type is missing or generic so strict browsers still render it.
    const contentType =
      inline && attachment.contentType !== "application/pdf" ? "application/pdf" : attachment.contentType;
    res.setHeader("Content-Type", contentType);
    // For inline preview, omit Content-Disposition entirely. Download-manager
    // network drivers (e.g. IDM's browser integration) treat any PDF response
    // carrying Content-Disposition as a file download and hijack it — the
    // browser's fetch() gets a forged empty 204 and the preview breaks. A bare
    // application/pdf response passes through untouched.
    if (!inline) {
      res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName}"`);
    }
    res.send(buffer);
  },
};
