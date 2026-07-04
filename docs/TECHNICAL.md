# Technical Guide — Initialization, Wiring & Real-time Flow

This document explains **how the system boots and connects at runtime**: how the Express
API is initialized, how Socket.IO is attached to it, how the Next.js UI is initialized,
how the browser establishes and maintains its socket connection, and *why* the design is
efficient. It is intentionally lower-level than the top-level [`README.md`](../README.md);
read that first for the product overview.

- **Frontend:** Next.js 16 (App Router, React 19) — `frontend/src/` (separate repo)
- **Backend:** Express 5 + Socket.IO 4 (TypeScript) — `backend/src/` (this repo)
- **Transport:** REST for commands/queries, WebSocket (Socket.IO) for live push

> Paths prefixed `frontend/` refer to the frontend repository; paths prefixed
> `backend/` refer to this repository's root.

```
┌────────────────────────┐        REST  (X-Org-Id header)        ┌────────────────────────┐
│   Next.js 16 (browser) │ ────────────────────────────────────▶ │      Express 5 API     │
│                        │                                        │                        │
│  OrgProvider (context) │ ◀──────── WebSocket (Socket.IO) ─────  │  Socket.IO  org:<id>   │
│  useRealtime hook      │        events to room org:<id>         │  rooms                 │
└────────────────────────┘                                        └────────────┬───────────┘
                                                                   Prisma 7 ────▼──── PostgreSQL
```

The key architectural idea: **REST mutates, sockets notify.** A write goes over HTTP, the
service layer commits it in a DB transaction, and *only then* emits a lightweight event to
the affected organisation's room. The event carries just an id + status — clients re-fetch
through the normal REST path. This keeps the socket layer thin and the data path single-sourced.

---

## 1. Express initialization

**File:** `backend/src/index.ts`

The app is built by a factory function, `createApp()`, which is deliberately separated from
the code that *starts* the server. This split is what lets the test suite import the app and
drive it with `supertest` without ever binding a port.

```ts
export function createApp() {
  const app = express();

  app.use(helmet());                                   // security headers
  app.use(cors({ origin: /* env-driven allow-list */ }));
  app.use(express.json({ limit: "5mb" }));             // JSON body parsing
  app.use(morgan("dev"));                              // request logging

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/organisations", organisationsRouter);
  app.use("/api/contracts/:id/attachments", attachmentsRouter); // nested — mounted first
  app.use("/api/contracts", contractsRouter);
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

  app.use(notFoundHandler);                            // 404 fallthrough
  app.use(errorHandler);                               // centralized error → JSON
  return app;
}
```

**Middleware order matters and is intentional:**

1. `helmet()` and `cors()` run first so every response (including errors) is hardened and
   correctly CORS-tagged.
2. `express.json()` parses the body before any route handler sees `req.body`.
3. Routers are mounted; note the **attachments router is registered before the contracts
   router** so the nested `:id` param resolves cleanly rather than being shadowed.
4. `notFoundHandler` then `errorHandler` are *last*. Because this is **Express 5**, thrown
   errors and rejected promises inside `async` handlers are auto-forwarded to the error
   middleware — handlers just `throw badRequest(...)` / `throw notFound(...)` and the
   centralized handler turns them into the correct status + JSON shape.

**Server startup** is guarded so it only runs when the file is the entrypoint:

```ts
if (require.main === module) {
  const app = createApp();
  const server = http.createServer(app);   // raw HTTP server, not app.listen()
  initSocket(server);                       // Socket.IO shares this server
  server.listen(env.port, () => { /* ... */ });
}
```

The critical detail: we create an explicit `http.Server` from the Express app rather than
calling `app.listen()`. **Express and Socket.IO must share one HTTP server** — Socket.IO
needs the raw server to hook the HTTP `upgrade` handshake that turns a request into a
WebSocket. `app.listen()` would create a server we couldn't hand to Socket.IO.

---

## 2. Socket.IO (server) initialization

**File:** `backend/src/lib/socket.ts`

Socket.IO is attached to the same HTTP server and holds a single module-level `io` instance:

```ts
let io: IOServer | null = null;
const room = (orgId: string) => `org:${orgId}`;

export function initSocket(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, { cors: { origin: /* same env allow-list */ } });

  io.on("connection", (socket) => {
    socket.on("join",  (orgId) => { if (validString(orgId)) socket.join(room(orgId)); });
    socket.on("leave", (orgId) => { if (typeof orgId === "string") socket.leave(room(orgId)); });
  });
  return io;
}

export function emitToOrg(orgId, event, payload) {
  io?.to(room(orgId)).emit(event, payload);   // broadcast to one tenant's room only
}
```

**How tenant isolation works on the wire.** Every client is placed into a
[Socket.IO room](https://socket.io/docs/v4/rooms/) named `org:<orgId>` when it emits `join`.
Broadcasts go through `emitToOrg()`, which targets `io.to("org:<id>")` — so an event for Acme
is *never* delivered to a socket that only joined Globex's room. The room mechanism is the
real-time counterpart of the REST `X-Org-Id` scoping: both enforce the same tenant boundary.

**Why a module-level singleton `io`?** The service layer (`services/contracts.ts`) needs to
emit events after a DB commit, but it must not depend on the HTTP request or the server
bootstrap. Exporting `emitToOrg()` backed by a private `io` gives the services a clean,
import-only way to broadcast. The `io?.` optional-chain means that in unit tests (where
`initSocket` was never called) emits are simply no-ops instead of crashing.

---

## 3. How a real-time event actually travels

**File:** `backend/src/services/contracts.ts`

Emits are **never** fired ad-hoc from route handlers. They happen in the service layer, and
always *after* the database transaction that made the change has committed:

```ts
export async function createContract(orgId, payload) {
  const contract = await prisma.$transaction(async (tx) => {
    const c = await tx.contract.create({ /* ... */ });
    await recordEvent(tx, { /* audit row in the SAME transaction */ });
    return c;
  });
  emitToOrg(orgId, "contract:created", { id: contract.id, status: contract.status });
  return contract;
}
```

This ordering guarantees **no phantom notifications**: a client can never be told about a
change that a subsequent rollback erased, because the emit is outside/after the transaction.
The three event types — `contract:created`, `contract:updated` (status changes),
`contract:deleted` — each carry a **minimal payload** (`{ id, status }` or `{ id }`), not the
full contract. Clients treat the event as an *invalidation signal* and re-fetch via REST.

End-to-end sequence for "User A finalizes a contract, User B sees it":

```
User A tab          Express API             DB            Socket.IO         User B tab
   │  POST /finalize    │                     │                │                 │
   ├───────────────────▶│                     │                │                 │
   │                    │  $transaction ─────▶│ (update+audit) │                 │
   │                    │◀──── commit ────────┤                │                 │
   │                    │  emitToOrg(...)  ───────────────────▶│ to org:<id>     │
   │◀─── 200 + JSON ────┤                     │                ├── "updated" ───▶│
   │                    │                     │                │                 │ re-fetch list
   │                    │◀──────────────── GET /api/contracts ─────────────────┤
```

---

## 4. Next.js UI initialization

**Files:** `frontend/src/app/layout.tsx`, `frontend/src/lib/org.tsx`

The App Router root layout wraps the whole tree in a single client-side context provider:

```tsx
<body>
  <OrgProvider>          {/* holds orgs, selected orgId, and drives socket room membership */}
    <Header />           {/* org selector + live indicator */}
    <main>{children}</main>
  </OrgProvider>
</body>
```

`OrgProvider` (`frontend/src/lib/org.tsx`) is the composition root for the client. On mount it does two
independent jobs, each in its own effect:

**a) Load organisations once and restore selection:**

```tsx
useEffect(() => {
  let active = true;
  api.listOrganisations().then((list) => {
    if (!active) return;
    setOrgs(list);
    const stored = localStorage.getItem("selectedOrgId");
    setOrgIdState(stored && list.some(o => o.id === stored) ? stored : list[0]?.id ?? null);
  }).finally(() => active && setLoading(false));
  return () => { active = false; };   // guard against setState after unmount
}, []);
```

The `active` flag is a standard cleanup guard so a slow response can't call `setState` on an
unmounted provider. Selection is persisted to `localStorage` so a reload keeps the same tenant.

**b) Keep the socket subscribed to the current org's room** — see §5.

The rest of the UI reads this context via `useOrg()`. Data pages (`contracts/page.tsx`, the
detail page) are `"use client"` components that fetch through the typed `api` client
(`frontend/src/lib/api.ts`), which injects the `X-Org-Id` header on every request.

---

## 5. Browser socket connection — creation & lifecycle

This is the heart of the client-side real-time story and spans three files.

### 5a. One shared socket per tab — `frontend/src/lib/socket.ts`

```ts
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
  }
  return socket;   // same instance for every caller
}
```

The socket is a **lazily-created, tab-wide singleton**. Every consumer (`OrgProvider`,
`useRealtime`, the header's `LiveIndicator`) calls `getSocket()` and shares the *same*
connection — the app opens exactly **one** WebSocket per browser tab regardless of how many
components listen. `transports: ["websocket", "polling"]` prefers a real WebSocket and keeps
long-polling only as a fallback.

### 5b. Room membership follows the selected org — `frontend/src/lib/org.tsx`

```tsx
useEffect(() => {
  if (!orgId) return;
  const socket = getSocket();
  const join = () => socket.emit("join", orgId);
  join();                       // join immediately
  socket.on("connect", join);   // AND re-join automatically after any reconnect
  return () => {
    socket.emit("leave", orgId);
    socket.off("connect", join);
  };
}, [orgId]);
```

Two things make this robust:

- **Re-join on reconnect.** Rooms live only for the duration of a socket connection. If the
  network drops and Socket.IO transparently reconnects, the server-side room membership is
  gone — so we re-bind `join` to the `connect` event. Without this, live updates would
  silently stop after any blip.
- **Switch tenants cleanly.** When the user changes org in the header, the effect's cleanup
  emits `leave` for the old room before the new run emits `join` for the new one. The single
  socket is reused; only its room membership changes. No reconnect, no new WebSocket.

### 5c. Subscribing to events — `frontend/src/lib/useRealtime.ts`

```tsx
export function useRealtime(handler) {
  useEffect(() => {
    const socket = getSocket();
    const onCreated = (p) => handler("created", p);
    const onUpdated = (p) => handler("updated", p);
    const onDeleted = (p) => handler("deleted", p);
    socket.on("contract:created", onCreated);
    socket.on("contract:updated", onUpdated);
    socket.on("contract:deleted", onDeleted);
    return () => {                               // always unbind on unmount / handler change
      socket.off("contract:created", onCreated);
      socket.off("contract:updated", onUpdated);
      socket.off("contract:deleted", onDeleted);
    };
  }, [handler]);
}
```

Any page opts into live updates by calling `useRealtime(...)`. The contracts list uses it as
a pure **invalidation signal** — it ignores the payload and just re-runs its loader:

```tsx
// frontend/src/app/contracts/page.tsx
useRealtime(useCallback(() => { load(); }, [load]));
```

Wrapping the handler in `useCallback` keeps its identity stable, so `useRealtime`'s effect
doesn't tear down and re-subscribe on every render — listeners are bound once and cleaned up
exactly once.

### 5d. Connection status indicator — `frontend/src/components/Header.tsx`

`LiveIndicator` subscribes to the socket's own `connect` / `disconnect` events to render the
green "Live" / grey "Offline" pill, giving the user honest feedback about the realtime channel
without any polling.

---

## 6. Why this design is efficient

| Concern | Design choice | Payoff |
|---|---|---|
| **Connections** | One lazily-created socket singleton per tab (`getSocket`) | N components, 1 WebSocket. No connection storms. |
| **Payload size** | Events carry `{ id, status }`, not the full contract | Tiny frames; the contract shape lives in one place (REST), never duplicated/desynced over the socket. |
| **Fan-out** | Server broadcasts to `org:<id>` rooms, not globally | Each frame reaches only the tenants who care; no client-side filtering, no cross-tenant leakage. |
| **Correctness** | Emit *after* the DB `$transaction` commits | Clients never see notifications for rolled-back writes. |
| **DB round-trips** | `listContracts` runs `findMany` + `count` in `Promise.all` | Page data and total fetched concurrently, not serially. |
| **Query cost** | Filtering + pagination pushed to SQL (`where/skip/take`) | Only one page of rows crosses the wire; DB does the work, not the client. |
| **Reconnects** | Re-`join` bound to the socket `connect` event | Live updates survive network blips automatically. |
| **Re-renders** | `useCallback`-stable handlers into `useRealtime` | Listeners bound once; no churn of add/remove on every render. |
| **Search input** | 250 ms debounce before firing the query (`setTimeout` in effect) | Typing doesn't spam the API; one request after the user pauses. |
| **Testability** | `createApp()` split from `listen()`; `io?.` optional emits | Tests run against the app in-process with no port and no socket server. |

---

## 7. File map (runtime-relevant)

| File | Responsibility |
|---|---|
| `backend/src/index.ts` | `createApp()` factory; wires middleware/routers; starts HTTP + Socket.IO |
| `backend/src/lib/socket.ts` | Socket.IO server init, per-org rooms, `emitToOrg()` |
| `backend/src/services/contracts.ts` | Business logic; DB transactions; emits events post-commit |
| `backend/src/middleware/orgScope.ts` | Validates `X-Org-Id`, pins `req.orgId` for REST tenant scoping |
| `backend/src/routes/contracts.ts` | REST endpoints; Zod validation; delegates to services |
| `frontend/src/app/layout.tsx` | Mounts `OrgProvider` + `Header` around all pages |
| `frontend/src/lib/org.tsx` | Org context; loads orgs; drives socket room join/leave/re-join |
| `frontend/src/lib/socket.ts` | Lazy tab-wide socket singleton (`getSocket`) |
| `frontend/src/lib/useRealtime.ts` | Hook to subscribe/unsubscribe to contract events |
| `frontend/src/lib/api.ts` | Typed REST client; injects `X-Org-Id`; `ApiError` shape |
| `frontend/src/components/Header.tsx` | Org selector + live connection indicator |
