# Local Development Guide

This guide explains how to run the **Contract Operations Console** on your own machine,
in two ways:

- **Option A — With Docker** (easiest, one command, nothing to install except Docker)
- **Option B — Without Docker** (run each piece by hand)

The app has three parts:

| Part      | What it is                     | Runs on                       |
| --------- | ------------------------------ | ----------------------------- |
| Database  | PostgreSQL (stores contracts)  | `localhost:5432`              |
| Backend   | Express REST API + Socket.IO   | `localhost:4000`              |
| Frontend  | Next.js web app                | `localhost:3000`              |

When everything is running, open **http://localhost:3000** in your browser.
The API docs (Swagger) live at **http://localhost:4000/api/docs**.

---

## Option A — With Docker (recommended for a quick start)

Docker runs the database, backend, and frontend for you in isolated containers, so you
don't need Postgres or Node installed locally.

### 1. Install Docker
Install **Docker Desktop** (Mac/Windows) or Docker Engine (Linux) and make sure it's running.
Check with:
```bash
docker --version
```

### 2. Heads-up about the folder layout
The Compose file lives at `¸backend/docker-compose.yml`. It was written for a setup where the
frontend sits **next to** the backend as a sibling folder named `contract-frontend`
(i.e. `../contract-frontend`).


### 3. Start everything
```bash
cd contract-backend
docker compose up --build
```

That single command will:
1. Start Postgres and wait until it's healthy.
2. Build and start the backend, which **automatically runs database migrations and seeds
   demo data** on first boot (see `docker-entrypoint.sh`).
3. Build and start the frontend.

### 4. Open the app
- Frontend: http://localhost:3000
- API: http://localhost:4000
- API docs: http://localhost:4000/api/docs

### 5. Stopping and resetting
```bash
# Stop the containers (keeps your data)
docker compose down

# Stop AND delete the database + uploaded files (fresh start)
docker compose down -v
```

### Useful Docker knobs
These are set in `contract-backend/docker-compose.yml` under the `contract-backend` service:

- `SEED_ON_START: "true"` → seed demo data **only when the database is empty** (default, safe).
- `SEED_ON_START: "always"` → **re-seed on every boot** (wipes and reloads — handy for demos).
- Uploaded PDFs are stored in a Docker volume (`uploads`), so they survive restarts until you
  run `down -v`.
---

## Option B — Without Docker

Here you run each piece yourself.

### Prerequisites
- **Node.js 22+** and npm
- **PostgreSQL 16** running locally (or any reachable Postgres). The easiest middle ground is
  to run *only* the database in Docker and everything else by hand:
  ```bash
  docker run --name contracts-db -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=contracts \
    -p 5432:5432 -d postgres:16-alpine
  ```

### 1. Set up the backend

```bash
cd contract-backend

# Install dependencies
npm install

# Create your environment file
touch .env
```

Open `.env` and make sure `DATABASE_URL` points at your Postgres. The default already matches
the Docker database above:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/contracts?schema=public"
PORT=4000
CORS_ORIGIN="http://localhost:3000"
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR="./uploads"
```

Now create the database tables and load demo data:
```bash
# Generate the Prisma client + apply migrations
npm run prisma:generate
npm run prisma:migrate:dev

# Load demo organisations and contracts
npm run prisma:seed
```

Start the API in watch mode (auto-restarts on code changes):
```bash
npm run dev
```
The API is now at **http://localhost:4000** and docs at **http://localhost:4000/api/docs**.

### 2. Set up the frontend

In a **second terminal**:
```bash
cd contract-frontend

# Install dependencies
npm install

# Create your environment file from the template
touch .env.local
```

The defaults in `.env.local` point at the local API, so no edits are needed:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
```

Start the dev server:
```bash
npm run dev
```
The web app is now at **http://localhost:3000**.

### 3. Handy backend commands

| Command                        | What it does                                             |
| ------------------------------ | ------------------------------------------------------- |
| `npm run dev`                  | Start API with hot-reload                                |
| `npm run prisma:migrate:dev`   | Create/apply a new migration during development          |
| `npm run prisma:seed`          | Load demo data                                           |
| `npm run db:reset`             | **Wipe** the database, re-run migrations, and re-seed    |
| `npm test`                     | Run the API test suite (vitest + supertest)              |
| `npm run build` / `npm start`  | Production build / run the compiled app                  |

---

## Verifying it works

The API is **multi-tenant** — every contract request must say which organisation it belongs to
using the **`X-Org-Id`** request header. The seed data creates two organisations
("Manchester United" and "Liverpool"), each with its own contracts.

Quick smoke test from the terminal:
```bash
# Health check (no auth needed)
curl http://localhost:4000/health

# List organisations (grab an org id from here)
curl http://localhost:4000/api/organisations

# List that org's contracts (paste an id into the header)
curl http://localhost:4000/api/contracts -H "X-Org-Id: <paste-an-org-id>"
```

In the browser, http://localhost:3000 lets you pick an organisation and browse/create
contracts, and updates appear in real time (Socket.IO) across open tabs of the same org.

---

## Troubleshooting

- **"Can't reach database" / connection refused** — Postgres isn't running or `DATABASE_URL`
  is wrong. Confirm the DB container/service is up and the host/port match.
- **Port already in use (4000 / 3000 / 5432)** — something else is using it. Stop the other
  process or change the port (`PORT` in backend `.env`, `-p` on the docker command).
- **Frontend loads but can't talk to the API / CORS errors** — check `NEXT_PUBLIC_API_URL` in
  `frontend/.env.local` and `CORS_ORIGIN` in `backend/.env` match your actual URLs. Note that
  `NEXT_PUBLIC_*` values are baked in **at build time**, so after changing them you must restart
  (`npm run dev`) or rebuild the frontend image.
- **Schema changed but errors persist** — re-run `npm run prisma:generate`, then
  `npm run prisma:migrate:dev`. To start completely fresh, use `npm run db:reset` (no Docker) or
  `docker compose down -v` (Docker).
- **Uploaded PDFs disappear** — with Docker they persist in the `uploads` volume until
  `down -v`; without Docker they live in `backend/uploads` (`LOCAL_UPLOAD_DIR`).
