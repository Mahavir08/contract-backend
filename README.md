# Contract Operations Console

A multi-tenant web application for managing purchase-order contracts: upload structured
contract JSON, run server-side search/filter, drive contracts through a status workflow
(`DRAFT → FINALIZED → ARCHIVED`), inspect a full audit trail, and see **real-time** status
updates across browser tabs.

- **Frontend:** Next.js 16 (App Router, React 19, Tailwind CSS 4)
- **Backend:** Express 5 + TypeScript REST API
- **Database:** PostgreSQL (contract payload stored as `JSONB`)
- **ORM:** Prisma 7 (driver adapter, `@prisma/adapter-pg`)
- **Real-time:** Socket.IO (per-organisation rooms)

---

## Features

- **Organisation scoping** — every request is scoped by an `X-Org-Id` header; no cross-org
  data access (attempts return `404`).
- **JSON upload + validation** — contract payloads are validated against the required schema
  (Zod); failures return `400` with a structured list of field errors driving inline UI feedback.
- **Server-side search** — filter by status, partial (case-insensitive) client-name match,
  contract ID, with pagination.
- **Status workflow** — `DRAFT → FINALIZED → ARCHIVED`; invalid transitions return `409`.
  Edits and deletes are permitted only on `DRAFT` contracts.
- **Audit trail** — every create / update / status-change / delete writes a `contract_events`
  row in the same transaction as the mutation.
- **Real-time** — status changes broadcast over Socket.IO to all tabs scoped to that org.
- **Bonus:** OpenAPI docs (`/api/docs`), PDF attachment upload/download, API tests, Docker Compose.

---

## Architecture

```
Next.js 16 (frontend)  ──REST (X-Org-Id header)──▶  Express API ──Prisma──▶ PostgreSQL (JSONB)
        ▲                                                  │
        └───────────── Socket.IO (org:<id> room) ─────────┘
```

### Repositories

The project is split into two repos, expected to be cloned **side by side**
(the compose file and deploy script reference the frontend as `../contract-frontend`):

- **contract-backend** (this repo) — Express API, Prisma schema, Docker Compose stack, deploy script, docs
- **contract-frontend** — Next.js app

### Project structure (this repo)

```
.
├── prisma/                  # schema.prisma, migrations, seed.ts
├── prisma.config.ts         # Prisma 7 config (connection URL for migrations)
├── src/
│   ├── routes/              # organisations, contracts, attachments
│   ├── services/            # contract + audit-event business logic
│   ├── schemas/             # Zod contract schema
│   ├── middleware/          # orgScope, error handler
│   ├── lib/                 # prisma, socket, storage, env, errors
│   └── docs/openapi.ts      # OpenAPI spec (served at /api/docs)
├── tests/                   # vitest + supertest API tests
├── Dockerfile               # API image
├── deploy/gcp-deploy.sh     # Cloud Run + Cloud SQL deploy script (both services)
└── docker-compose.yml       # one-command local stack (db + API + frontend)
```

---

## Quick start (Docker Compose — recommended)

Requires Docker, with both repos cloned as siblings:

```bash
git clone <backend-repo-url> contract-backend
git clone <frontend-repo-url> contract-frontend
cd contract-backend
docker compose up --build
```

This starts Postgres, runs migrations, **seeds 2 organisations + 5 contracts**, and starts
both services:

- Frontend → http://localhost:3000
- API → http://localhost:4000
- API docs (Swagger UI) → http://localhost:4000/api/docs

---

## Local development (without Docker)

Requires Node.js 20+ and a local PostgreSQL 14+.

### 1. Backend (from this repo's root)

```bash
cp .env.example .env          # adjust DATABASE_URL if needed
npm install
npm run prisma:migrate:dev    # create schema
npm run prisma:seed           # seed 2 orgs + 5 contracts
npm run dev                   # API on http://localhost:4000
```

### 2. Frontend (in a second terminal, from the frontend repo)

```bash
cd ../contract-frontend
cp .env.local.example .env.local
npm install
npm run dev                   # app on http://localhost:3000
```

---

## Environment variables

### Backend (`.env` in this repo)

| Variable           | Description                                             | Example |
|--------------------|---------------------------------------------------------|---------|
| `DATABASE_URL`     | PostgreSQL connection string                            | `postgresql://postgres:postgres@localhost:5432/contracts?schema=public` |
| `PORT`             | API port                                                | `4000` |
| `CORS_ORIGIN`      | Allowed frontend origin(s), comma-separated, or `*`     | `http://localhost:3000` |
| `STORAGE_DRIVER`   | Attachment storage: `local` or `gcs`                    | `local` |
| `LOCAL_UPLOAD_DIR` | Upload dir when `STORAGE_DRIVER=local`                  | `./uploads` |
| `GCS_BUCKET`       | Bucket name when `STORAGE_DRIVER=gcs`                   | `my-bucket` |
| `SEED_ON_START`    | (Docker/Cloud Run) seed the DB on container boot        | `true` |

### Frontend (`.env.local` in the frontend repo)

| Variable                  | Description                    | Example |
|---------------------------|--------------------------------|---------|
| `NEXT_PUBLIC_API_URL`     | Base URL of the backend API    | `http://localhost:4000` |
| `NEXT_PUBLIC_SOCKET_URL`  | Base URL of the Socket.IO server | `http://localhost:4000` |

> `NEXT_PUBLIC_*` values are inlined at **build time**; when building the frontend image pass
> them as `--build-arg`.

---

## Contract JSON schema

```json
{
  "client_name": "string (required)",
  "po_ref_no": "string (required)",
  "po_date": "YYYY-MM-DD (required)",
  "payment_terms": "string (optional)",
  "delivery_terms": "string (optional)",
  "items": [
    {
      "description": "string (required)",
      "quantity": "number > 0 (required)",
      "quantity_unit": "string (optional)",
      "unit_price": "number >= 0 (required)",
      "pricing_unit": "string (optional)",
      "total": "number (optional)"
    }
  ]
}
```

---

## API reference

All `/api/contracts` routes require an `X-Org-Id` header. Full interactive docs at `/api/docs`.

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/organisations` | List organisations (for the selector) |
| GET    | `/api/contracts` | Search: `?status=&clientName=&contractId=&page=&pageSize=` |
| POST   | `/api/contracts` | Upload + validate a contract (→ DRAFT) |
| GET    | `/api/contracts/:id` | Contract detail |
| PATCH  | `/api/contracts/:id` | Update a DRAFT contract |
| POST   | `/api/contracts/:id/finalize` | DRAFT → FINALIZED |
| POST   | `/api/contracts/:id/archive` | FINALIZED → ARCHIVED |
| DELETE | `/api/contracts/:id` | Delete a DRAFT contract |
| GET    | `/api/contracts/:id/events` | Audit history |
| GET/POST | `/api/contracts/:id/attachments` | List / upload PDF attachments |
| GET    | `/api/contracts/:id/attachments/:attachmentId/download` | Download a PDF |

**Status codes:** `400` validation / missing org, `404` not found / cross-org, `409` invalid
status transition or mutation on a non-draft.

---

## Real-time

The backend keeps each Socket.IO client in a room named `org:<orgId>`. On create, status
change, and delete it emits `contract:created` / `contract:updated` / `contract:deleted` to
that room only. The frontend joins the current org's room and refreshes affected views live —
open two tabs, finalize a contract in one, and watch the status update in the other.

---

## Testing

```bash
# Requires a Postgres test DB. With the compose DB running:
#   createdb contracts_test  (or: docker exec <db> psql -U postgres -c "CREATE DATABASE contracts_test;")
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/contracts_test?schema=public" npm run prisma:migrate
npm test
```

Covers org scoping/isolation, JSON validation, search + filter + pagination, the full status
workflow (including `409` on invalid transitions and non-draft edits/deletes), and audit events.

---

## Deployment (GCP — Cloud Run + Cloud SQL)

An end-to-end script is provided:

```bash
PROJECT_ID=your-project REGION=us-central1 DB_PASSWORD=your-secret ./deploy/gcp-deploy.sh
```

It enables the required APIs, provisions a Cloud SQL Postgres instance, builds & pushes both
container images, and deploys the backend and frontend to Cloud Run. The backend service is
deployed with **session affinity** (so Socket.IO connections stick) and connects to Cloud SQL
over a unix socket. `CORS_ORIGIN` is set to the deployed frontend URL. Migrations and seeding
run automatically on container boot (`SEED_ON_START=true`).

### Deployed URL & evaluation access

> **Deployed app:** _add your Cloud Run frontend URL here after deploying._
> **API docs:** `<backend-url>/api/docs`
>
> No login is required — pick an organisation from the selector in the top-right to begin.

---

## Seed data

Seeding creates 2 organisations (**Acme Corporation**, **Globex Industries**) and 5 contracts
spanning all statuses (`DRAFT`, `FINALIZED`, `ARCHIVED`), each with a matching audit history.
