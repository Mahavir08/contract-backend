import { z } from "zod";

// Required contract JSON schema (mirrors the assignment spec exactly).
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "po_date must be in YYYY-MM-DD format")
  .refine((s) => !Number.isNaN(Date.parse(s)), "po_date must be a valid date");

export const contractItemSchema = z.object({
  description: z.string().min(1, "description is required"),
  quantity: z.number().positive("quantity must be > 0"),
  quantity_unit: z.string().optional(),
  unit_price: z.number().min(0, "unit_price must be >= 0"),
  pricing_unit: z.string().optional(),
  total: z.number().optional(),
});

export const contractPayloadSchema = z.object({
  client_name: z.string().min(1, "client_name is required"),
  po_ref_no: z.string().min(1, "po_ref_no is required"),
  po_date: isoDate,
  payment_terms: z.string().optional(),
  delivery_terms: z.string().optional(),
  items: z.array(contractItemSchema).min(1, "at least one item is required"),
});

export type ContractPayload = z.infer<typeof contractPayloadSchema>;

// For editing a draft: allow updating the payload fields. Same shape (full replace).
export const contractUpdateSchema = contractPayloadSchema;

export type FieldError = { path: string; message: string };

// Flatten Zod issues into a UI-friendly list of { path, message }.
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
