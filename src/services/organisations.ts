import { prisma } from "../lib/prisma";
import { emitToAll } from "../lib/socket";
import { slugify, type CreateOrganisationInput } from "../schemas/organisation";

// Not org-scoped: powers the tenant selector.
export function listOrganisations() {
  return prisma.organisation.findMany({ orderBy: { name: "asc" } });
}

// Create an org, deriving a unique slug from the provided slug or the name.
export async function createOrganisation(input: CreateOrganisationInput) {
  const base = slugify(input.slug ?? input.name) || "org";
  const slug = await uniqueSlug(base);
  const org = await prisma.organisation.create({ data: { name: input.name, slug } });
  // Orgs aren't room-scoped: every tab's tenant selector must learn about it.
  emitToAll("organisation:created", org);
  return org;
}

// Slugs are unique; probe with numeric suffixes until we find a free one.
async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await prisma.organisation.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}
