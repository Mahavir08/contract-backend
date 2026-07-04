# Problem Statement & What We Built

## The problem

Teams that process **purchase-order (PO) contracts** typically receive them as structured
data (exported JSON from an upstream system) and then need a place to:

- bring those contracts in and **validate** that they are well-formed before they enter the workflow,
- **find** a specific contract quickly among many (by client, by PO/contract identifier, by state),
- move each contract through a controlled **lifecycle** — from a working draft, to a locked-in
  finalized state, to an archived record — without allowing illegal jumps or edits after lock-in,
- keep a trustworthy **audit trail** of who/what changed and when, and
- do all of this for **multiple organisations (tenants)** on shared infrastructure, with a hard
  guarantee that one organisation can never see or touch another's data.

On top of that, contract operations are collaborative: several people may be looking at the
same list at once. When one person changes a contract's status, everyone else should see it
**without refreshing the page**.

### Requirements we set out to satisfy

1. **Multi-tenancy** — every operation is scoped to an organisation; strict isolation, no cross-org access.
2. **Structured upload + validation** — accept contract JSON, validate against a defined schema, reject bad input with actionable, field-level errors.
3. **Search & filter, server-side** — filter by status, partial client-name match, and contract ID, with pagination — computed in the database, not the browser.
4. **Status workflow** — enforce `DRAFT → FINALIZED → ARCHIVED`; reject invalid transitions; allow edits/deletes only while `DRAFT`.
5. **Audit trail** — record every create, update, status change, and delete.
6. **Real-time updates** — push changes live to all users viewing the same organisation.

### Stretch goals (bonuses)

- API documentation, containerized one-command local setup, automated API tests, and file (PDF) attachments.

---

## What we built

**Contract Operations Console** — a full-stack, multi-tenant web application that delivers all
of the above.

### At a glance

| Requirement | How it's met |
|---|---|
| Multi-tenancy & isolation | `X-Org-Id` header required on every scoped request; middleware validates the org and pins `req.orgId`; queries are always filtered by `orgId`; cross-org access returns `404`. Real-time is isolated the same way via per-org Socket.IO rooms. |
| Upload + validation | `POST /api/contracts` validates the JSON payload with a **Zod** schema; failures return `400` with a structured list of field errors that the UI renders inline. |
| Server-side search | `GET /api/contracts?status=&clientName=&contractId=&page=&pageSize=` — filtering + pagination executed in PostgreSQL (`where` / `skip` / `take`), with data and total count fetched concurrently. |
| Status workflow | A transition guard enforces `DRAFT → FINALIZED → ARCHIVED`; invalid moves and edits/deletes on non-draft contracts return `409`. |
| Audit trail | Every mutation writes a `contract_events` row **in the same DB transaction** as the change, so the history can never diverge from the data. |
| Real-time | On create / status-change / delete the server emits a lightweight event to the affected org's room; open clients re-fetch and update live. A header indicator shows connection status. |

### The stack

- **Frontend:** Next.js 16 (App Router, React 19), Tailwind CSS 4
- **Backend:** Express 5 + TypeScript REST API, with Socket.IO 4 for real-time
- **Database:** PostgreSQL — the raw contract payload is stored as `JSONB` (`fieldData`) alongside promoted columns (client, PO ref, dates, status) for fast filtering
- **ORM:** Prisma 7 (driver adapter, `@prisma/adapter-pg`)
- **Deployment target:** GCP Cloud Run + Cloud SQL

### Architectural decisions worth calling out

- **Separate Express API from the Next.js app** rather than Next API routes — a clean REST
  boundary, independently deployable, and a natural home for the shared Socket.IO server.
- **REST mutates, sockets notify.** Writes go over HTTP and are committed transactionally;
  the socket only carries small invalidation signals (`{ id, status }`). The full contract
  shape lives in exactly one place (the REST response), so it can't desync over two channels.
- **Isolation enforced twice, consistently.** The REST `X-Org-Id` scope and the Socket.IO
  `org:<id>` rooms are two expressions of the same tenant boundary.
- **JSONB + promoted columns.** The original document is preserved verbatim for fidelity/audit,
  while the fields we filter on are indexed columns for query performance.

### Bonuses — all delivered

- **OpenAPI docs** served at `/api/docs` (Swagger UI).
- **Docker Compose** — one command (`docker compose up --build`) brings up Postgres, runs
  migrations, seeds data, and starts both services.
- **Automated API tests** (Vitest + Supertest) covering org isolation, validation, search,
  the full workflow including `409`s, and audit events.
- **PDF attachments** — upload/download per contract, with pluggable local/GCS storage.

### Seed data

Two organisations (**Manchester United**, **Liverpool**) and five contracts spanning
all three statuses, each with matching audit history — enough to demonstrate isolation,
search, workflow, and real-time out of the box.

---

## Status

Build and verification complete: workflow, org isolation, real-time, the test suite, the
Docker Compose stack, and the frontend production build all pass. A GCP deploy script
(`deploy/gcp-deploy.sh`) is written; running the actual cloud deploy is the remaining step.

For the runtime/wiring details (how Express, Socket.IO, and the UI initialize and connect),
see [`TECHNICAL.md`](./TECHNICAL.md). For setup and API reference, see the top-level
[`README.md`](../README.md).
