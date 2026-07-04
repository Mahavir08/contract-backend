import { z } from "zod";

// Validation for creating an organisation. `name` is required; `slug` is
// optional and, when omitted, is derived from the name server-side.
export const createOrganisationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name is required")
    .max(100, "name must be at most 100 characters"),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase letters, numbers, and dashes")
    .max(60, "slug must be at most 60 characters")
    .optional(),
});

export type CreateOrganisationInput = z.infer<typeof createOrganisationSchema>;

// Derive a URL-safe slug from free-text input.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
