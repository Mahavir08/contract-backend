import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/index";
import { prisma } from "../src/lib/prisma";

const app = createApp();

const validPayload = {
  client_name: "Test Client",
  po_ref_no: "PO-TEST-1",
  po_date: "2026-06-01",
  items: [{ description: "Widget", quantity: 5, unit_price: 10 }],
};

let orgA = "";
let orgB = "";

beforeAll(async () => {
  // Clean slate for the test database.
  await prisma.contractEvent.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.organisation.deleteMany();
  const a = await prisma.organisation.create({ data: { name: "Org A", slug: "org-a" } });
  const b = await prisma.organisation.create({ data: { name: "Org B", slug: "org-b" } });
  orgA = a.id;
  orgB = b.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("org scoping + validation", () => {
  it("rejects requests without X-Org-Id (400)", async () => {
    await request(app).get("/api/contracts").expect(400);
  });

  it("rejects invalid contract JSON with field errors (400)", async () => {
    const res = await request(app)
      .post("/api/contracts")
      .set("x-org-id", orgA)
      .send({ client_name: "", items: [] })
      .expect(400);
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("creates a contract and records a CREATED event", async () => {
    const res = await request(app).post("/api/contracts").set("x-org-id", orgA).send(validPayload).expect(201);
    expect(res.body.status).toBe("DRAFT");
    const events = await request(app).get(`/api/contracts/${res.body.id}/events`).set("x-org-id", orgA).expect(200);
    expect(events.body.map((e: { eventType: string }) => e.eventType)).toContain("CREATED");
  });

  it("does not leak contracts across organisations (404)", async () => {
    const created = await request(app).post("/api/contracts").set("x-org-id", orgA).send(validPayload);
    await request(app).get(`/api/contracts/${created.body.id}`).set("x-org-id", orgB).expect(404);
  });
});

describe("search, filter, pagination", () => {
  it("filters by status and paginates", async () => {
    const res = await request(app)
      .get("/api/contracts?status=DRAFT&page=1&pageSize=2")
      .set("x-org-id", orgA)
      .expect(200);
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.data.every((c: { status: string }) => c.status === "DRAFT")).toBe(true);
  });

  it("searches by partial client name (case-insensitive)", async () => {
    const res = await request(app).get("/api/contracts?clientName=test cli").set("x-org-id", orgA).expect(200);
    expect(res.body.total).toBeGreaterThan(0);
  });
});

describe("status workflow", () => {
  it("enforces DRAFT -> FINALIZED -> ARCHIVED and rejects invalid transitions with 409", async () => {
    const created = await request(app).post("/api/contracts").set("x-org-id", orgA).send(validPayload);
    const id = created.body.id;

    // DRAFT -> ARCHIVED is invalid
    await request(app).post(`/api/contracts/${id}/archive`).set("x-org-id", orgA).expect(409);

    // DRAFT -> FINALIZED ok
    await request(app).post(`/api/contracts/${id}/finalize`).set("x-org-id", orgA).expect(200);

    // editing a non-draft is rejected
    await request(app).patch(`/api/contracts/${id}`).set("x-org-id", orgA).send(validPayload).expect(409);

    // deleting a non-draft is rejected
    await request(app).delete(`/api/contracts/${id}`).set("x-org-id", orgA).expect(409);

    // FINALIZED -> ARCHIVED ok
    await request(app).post(`/api/contracts/${id}/archive`).set("x-org-id", orgA).expect(200);

    const events = await request(app).get(`/api/contracts/${id}/events`).set("x-org-id", orgA);
    const types = events.body.map((e: { eventType: string }) => e.eventType);
    expect(types.filter((t: string) => t === "STATUS_CHANGED").length).toBe(2);
  });

  it("soft-deletes a draft (204), hides it, but retains a traceable audit event", async () => {
    const created = await request(app).post("/api/contracts").set("x-org-id", orgA).send(validPayload);
    const id = created.body.id;
    await request(app).delete(`/api/contracts/${id}`).set("x-org-id", orgA).expect(204);

    // Hidden from reads and the default listing...
    await request(app).get(`/api/contracts/${id}`).set("x-org-id", orgA).expect(404);
    const list = await request(app).get("/api/contracts").set("x-org-id", orgA);
    expect(list.body.data.some((c: { id: string }) => c.id === id)).toBe(false);

    // ...but the row is retained (soft delete), not removed.
    const row = await prisma.contract.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeInstanceOf(Date);

    // The deletion is traceable from contract_events with the contractId preserved
    // and recorded as a DRAFT -> DELETED transition (toStatus = DELETED).
    const deletedEvents = await prisma.contractEvent.findMany({
      where: { eventType: "DELETED", contractId: id },
    });
    expect(deletedEvents.length).toBe(1);
    expect(deletedEvents[0].fromStatus).toBe("DRAFT");
    expect(deletedEvents[0].toStatus).toBe("DELETED");

    // The audit history stays viewable after deletion.
    const events = await request(app).get(`/api/contracts/${id}/events`).set("x-org-id", orgA).expect(200);
    expect(events.body.map((e: { eventType: string }) => e.eventType)).toContain("DELETED");
  });
});
