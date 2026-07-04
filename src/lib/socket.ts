import { Server as HttpServer } from "http";
import { Server as IOServer } from "socket.io";
import { env } from "./env";

let io: IOServer | null = null;

const room = (orgId: string) => `org:${orgId}`;

// Tiny timestamped logger so the socket lifecycle is easy to follow in the
// terminal. Every log below is prefixed with [socket] so you can filter it.
const log = (...args: unknown[]) =>
  console.log(`[socket ${new Date().toISOString().slice(11, 23)}]`, ...args);

// Attach a Socket.IO server that keeps clients in per-organisation rooms so
// broadcasts never leak across tenants.
export function initSocket(httpServer: HttpServer): IOServer {
  // (1) SERVER STARTUP — this runs ONCE, when the API boots. It bolts a
  // WebSocket server onto the same HTTP server Express uses, so the browser
  // upgrades a normal HTTP request to a long-lived WebSocket on the same port.
  io = new IOServer(httpServer, {
    cors: { origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(",") },
  });
  log("Socket.IO server initialised and listening for connections");

  // (2) A UI TAB CONNECTED — fires every time a browser tab opens a socket
  // (i.e. when `getSocket()` runs on the frontend). `socket` represents that
  // ONE tab; `socket.id` is its unique connection id. Each tab = one `socket`.
  io.on("connection", (socket) => {
    log(
      `⬆️  CONNECT   tab connected  id=${socket.id}  ` +
        `total-clients=${io?.engine.clientsCount}  transport=${socket.conn.transport.name}`
    );

    // (3) JOIN A GROUP (ROOM) — the tab asks to be scoped to an org. Rooms are
    // Socket.IO's grouping primitive: `socket.join(name)` puts this connection
    // into a named bucket. A room is created lazily the first time someone
    // joins it, and destroyed automatically when the last member leaves.
    socket.on("join", (orgId: string) => {
      if (typeof orgId === "string" && orgId.length > 0) {
        socket.join(room(orgId));
        log(
          `👥 JOIN      id=${socket.id}  joined room "${room(orgId)}"  ` +
            `rooms-for-this-tab=[${[...socket.rooms].join(", ")}]`
        );
      } else {
        log(`⚠️  JOIN      id=${socket.id}  ignored invalid orgId:`, orgId);
      }
    });

    // (4) LEAVE A GROUP — the tab switches org (or unmounts) and asks to be
    // removed from the room, so it stops receiving that org's broadcasts.
    socket.on("leave", (orgId: string) => {
      if (typeof orgId === "string") {
        socket.leave(room(orgId));
        log(`🚪 LEAVE     id=${socket.id}  left room "${room(orgId)}"`);
      }
    });

    // (5) A UI TAB EXITED — fires when the tab is closed, refreshed, navigates
    // away, or the network drops. Socket.IO auto-removes it from every room.
    // `reason` tells you WHY (e.g. "transport close" = tab closed/refreshed,
    // "ping timeout" = network died, "client namespace disconnect" = explicit).
    socket.on("disconnect", (reason) => {
      log(
        `⬇️  DISCONNECT tab left  id=${socket.id}  reason="${reason}"  ` +
          `remaining-clients=${io?.engine.clientsCount}`
      );
    });
  });

  return io;
}

export type ContractRealtimeEvent =
  | "contract:created"
  | "contract:updated"
  | "contract:deleted";

export type GlobalRealtimeEvent = "organisation:created";

// (6b) COMMUNICATION (server → ALL UIs) — push a message to every connected
// tab, regardless of org room. Used for events about the org list itself
// (e.g. a new organisation), which every tenant selector needs to see.
export function emitToAll(event: GlobalRealtimeEvent, payload: unknown) {
  if (!io) {
    log(`⚠️  EMIT      no io server yet; dropped "${event}"`);
    return;
  }
  log(
    `📢 EMIT      "${event}" → all tabs  ` +
      `recipients=${io.engine.clientsCount}  payload=${JSON.stringify(payload)}`
  );
  io.emit(event, payload);
}

// (6) COMMUNICATION (server → UI) — push a message to EVERY tab currently in
// this org's room. `.to(room)` targets the group; `.emit(event, payload)` is
// the actual send. The frontend's `socket.on(event, ...)` handlers fire in
// response. `fetchSockets()` is only used here to log how many tabs received it.
export function emitToOrg(orgId: string, event: ContractRealtimeEvent, payload: unknown) {
  if (!io) {
    log(`⚠️  EMIT      no io server yet; dropped "${event}"`);
    return;
  }
  io.to(room(orgId))
    .fetchSockets()
    .then((clients) =>
      log(
        `📢 EMIT      "${event}" → room "${room(orgId)}"  ` +
          `recipients=${clients.length}  payload=${JSON.stringify(payload)}`
      )
    );
  io.to(room(orgId)).emit(event, payload);
}
