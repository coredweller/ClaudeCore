# TypeScript REST API — Resource Lifecycle & Graceful Shutdown

## Purpose

This file gives the full Node.js / Fastify implementation of the resource lifecycle contract defined in `code-standards.md`. Read that contract first; this file is the TypeScript instantiation of it.

---

## src/server.ts — Full Implementation

```typescript
import { loadApp } from './app.js';
import { initDb, closeDb, getDb } from './db.js';
import { config } from './config.js';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const server = await loadApp();    // 1. Build Fastify app — no resource access
await initDb();                    // 2. Connect DB pool + verify with pool.connect()

// 3. Run pending migrations — after initDb() (getDb() throws before it), before listen()
// (before accepting traffic). drizzle-orm/node-postgres/migrator matches the pg driver
// this skill uses (see reference/service-database.md) — NOT drizzle-orm/postgres-js/migrator.
if (config.NODE_ENV !== 'test') {
  await migrate(getDb(), { migrationsFolder: './migrations' });
}

await server.listen({ port: config.PORT, host: '0.0.0.0' });

server.log.info({ port: config.PORT }, 'Server started');

async function shutdown(signal: string): Promise<void> {
  server.log.info({ signal }, 'Shutdown signal received');

  // Force-exit timer — started when shutdown begins, not at process start.
  // unref() prevents the timer from keeping the event loop alive on its own;
  // if all teardown finishes before 10 s, the process can exit without waiting for it.
  const forceExit = setTimeout(() => {
    server.log.error('Graceful shutdown timed out after 10 s — force exiting');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    // Destroy keep-alive sockets that have no in-flight request.
    // Without this, server.close() waits forever — idle persistent connections
    // never finish on their own.
    server.server.closeIdleConnections();

    // Stop accepting new connections; resolve once all in-flight requests finish.
    await server.close();

    // Tear down resources in reverse init order.
    await closeDb();

    server.log.info({ signal }, 'Shutdown complete');
    process.exit(0);
  } catch (err) {
    server.log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
```

---

## Why Each Piece

| Step | Why |
|------|-----|
| `migrate()` after `initDb()` | Needs a live pool, so it can't run in `loadApp()` (no DB access there) or before `initDb()`. Runs before `listen()` so the process never accepts traffic against a schema it hasn't migrated yet. Skipped in tests — `NODE_ENV=test` never runs `server.ts`, but the guard makes the intent explicit. |
| `closeIdleConnections()` | HTTP/1.1 keep-alive clients hold sockets open between requests. `server.close()` only stops new accepts; idle sockets never finish on their own, so `server.close()` would hang. This destroys them immediately. |
| `await server.close()` | Drains in-flight requests. Resolves once all active connections are finished or destroyed. |
| `await closeDb()` | Returns the pool to the OS. Called after `server.close()` so no request is still mid-query when the pool is drained. |
| `process.exit(0)` | Explicit exit prevents stray async callbacks or timers from re-entering after teardown is done. |
| Force-exit timer | Safety net for stalled teardown. If a connection never closes, `server.close()` hangs forever; the 10 s timer guarantees the process terminates so the orchestrator can restart it. |
| `forceExit.unref()` | Prevents the timer from itself keeping the event loop open. If teardown finishes cleanly before 10 s, the process exits normally without waiting for the timer to fire. |
| SIGTERM + SIGINT | SIGTERM is the orchestrator signal (K8s, systemd, Docker). SIGINT is Ctrl-C in dev. Both need the same handler. |

---

## Multiple Resources

Add resources in init order; tear down in reverse:

```typescript
await initDb();       // init 1
await initRedis();    // init 2

// In shutdown():
await closeRedis();   // reverse: 2 first
await closeDb();      // reverse: 1 last
```

Each resource follows the contract from `code-standards.md`:
- `initX()` — double-init guard, fail-fast health check before returning
- `closeX()` — idempotent; never throws; nulls internal state
- `getX()` — throws with a message naming the resource and init function

---

## Kubernetes Pod Termination

When K8s terminates a pod:

```
K8s sends SIGTERM
  ↓
preStop hook runs (if configured) — e.g. sleep 5 to let kube-proxy drain routing
  ↓
SIGTERM delivered to PID 1 in the container
  ↓
shutdown() runs — server drains, resources close
  ↓
process.exit(0)  ← must happen before terminationGracePeriodSeconds elapses
  ↓
[if not exited] K8s sends SIGKILL after terminationGracePeriodSeconds
```

### Deployment settings

```yaml
# deployment.yaml
spec:
  terminationGracePeriodSeconds: 20   # outer K8s deadline — must exceed our 10 s
                                      # timer + preStop duration + a few seconds margin
  containers:
    - lifecycle:
        preStop:
          exec:
            command: ["sleep", "5"]   # delay SIGTERM so kube-proxy finishes
                                      # updating iptables before the server stops
                                      # accepting; prevents ECONNREFUSED on in-flight
                                      # requests that route to this pod after SIGTERM
```

### Sizing `terminationGracePeriodSeconds`

**Rule:** `terminationGracePeriodSeconds` > `forceExitMs / 1000` + `preStop duration` + 3 s margin.

With the defaults above: `20 > 10 + 5 + 3` — correct.

If you set it ≤ 10 s, K8s sends SIGKILL before our force-exit timer fires, masking the timeout log and preventing the `exit(1)` from being recorded.

### Why `preStop: sleep`

After SIGTERM is sent, kube-proxy takes 1–5 s to finish propagating the pod's removal from iptables rules. During that window, new connections still route to this pod. If the server stops accepting immediately on SIGTERM, those requests get `ECONNREFUSED`. The `preStop` sleep stalls the SIGTERM delivery by that same window, so routing has settled before the server begins draining.
