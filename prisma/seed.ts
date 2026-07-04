import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type SeedItem = {
  description: string;
  quantity: number;
  quantity_unit?: string;
  unit_price: number;
  pricing_unit?: string;
  total?: number;
};

function payload(clientName: string, poRefNo: string, poDate: string, items: SeedItem[]) {
  return {
    client_name: clientName,
    po_ref_no: poRefNo,
    po_date: poDate,
    payment_terms: "Net 30",
    delivery_terms: "FOB Destination",
    items,
  };
}

async function main() {
  // Idempotent: clear existing data so re-seeding is safe.
  await prisma.contractEvent.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.organisation.deleteMany();

  const manUtd = await prisma.organisation.create({
    data: { name: "Manchester United", slug: "manchester-united" },
  });
  const liverpool = await prisma.organisation.create({
    data: { name: "Liverpool", slug: "liverpool" },
  });

  const seeds: Array<{
    org: { id: string };
    clientName: string;
    poRefNo: string;
    poDate: string;
    status: "DRAFT" | "FINALIZED" | "ARCHIVED";
    items: SeedItem[];
  }> = [
    {
      org: manUtd,
      clientName: "Northwind Traders",
      poRefNo: "PO-1001",
      poDate: "2026-01-15",
      status: "DRAFT",
      items: [
        { description: "Steel bolts M8", quantity: 500, quantity_unit: "pcs", unit_price: 0.25, pricing_unit: "per pc", total: 125 },
      ],
    },
    {
      org: manUtd,
      clientName: "Northwind Logistics",
      poRefNo: "PO-1002",
      poDate: "2026-02-02",
      status: "FINALIZED",
      items: [
        { description: "Pallet racking", quantity: 20, quantity_unit: "units", unit_price: 320, pricing_unit: "per unit", total: 6400 },
        { description: "Installation service", quantity: 1, unit_price: 1500, total: 1500 },
      ],
    },
    {
      org: manUtd,
      clientName: "Contoso Ltd",
      poRefNo: "PO-1003",
      poDate: "2025-12-10",
      status: "ARCHIVED",
      items: [
        { description: "Annual maintenance", quantity: 12, quantity_unit: "months", unit_price: 800, pricing_unit: "per month", total: 9600 },
      ],
    },
    {
      org: liverpool,
      clientName: "Initech",
      poRefNo: "PO-2001",
      poDate: "2026-03-05",
      status: "DRAFT",
      items: [
        { description: "TPS report licenses", quantity: 50, quantity_unit: "seats", unit_price: 45, pricing_unit: "per seat", total: 2250 },
      ],
    },
    {
      org: liverpool,
      clientName: "Stark Industries",
      poRefNo: "PO-2002",
      poDate: "2026-03-20",
      status: "FINALIZED",
      items: [
        { description: "Arc reactor components", quantity: 4, quantity_unit: "kits", unit_price: 12500, pricing_unit: "per kit", total: 50000 },
        { description: "Expedited shipping", quantity: 1, unit_price: 3000, total: 3000 },
      ],
    },
  ];

  for (const s of seeds) {
    const data = payload(s.clientName, s.poRefNo, s.poDate, s.items);
    const contract = await prisma.contract.create({
      data: {
        orgId: s.org.id,
        clientName: s.clientName,
        poRefNo: s.poRefNo,
        poDate: new Date(s.poDate),
        status: s.status,
        fieldData: data,
      },
    });

    // Seed a plausible audit history matching the final status.
    await prisma.contractEvent.create({
      data: {
        orgId: s.org.id,
        contractId: contract.id,
        eventType: "CREATED",
        toStatus: "DRAFT",
        changes: { payload: data },
      },
    });
    if (s.status === "FINALIZED" || s.status === "ARCHIVED") {
      await prisma.contractEvent.create({
        data: {
          orgId: s.org.id,
          contractId: contract.id,
          eventType: "STATUS_CHANGED",
          fromStatus: "DRAFT",
          toStatus: "FINALIZED",
        },
      });
    }
    if (s.status === "ARCHIVED") {
      await prisma.contractEvent.create({
        data: {
          orgId: s.org.id,
          contractId: contract.id,
          eventType: "STATUS_CHANGED",
          fromStatus: "FINALIZED",
          toStatus: "ARCHIVED",
        },
      });
    }
  }

  const orgs = await prisma.organisation.count();
  const contracts = await prisma.contract.count();
  console.log(`Seeded ${orgs} organisations and ${contracts} contracts.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
