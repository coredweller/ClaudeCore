# TypeScript REST API — Resource Lifecycle & Graceful Shutdown

The Node.js / Fastify implementation of the resource lifecycle contract in `code-standards.md`.
Read that contract first; this is its TypeScript instantiation.

---

## src/server.ts — Full Implementation

```typescript
import { loadApp } from './app.js';
import { initDb, closeDb, getDb } from './db.js';
import { config } from './config.js';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const server = await loadApp();    // 1. Build Fastify app — no resource access
await initDb();                    // 2. Connect DB pool + verify with pool.connect()

// 3. Pending migrations — after initDb() (getDb() throws before it), before listen().
// The migrator import matches the pg driver this skill uses, NOT postgres-js/migrator.
if (config.NODE_ENV !== 'test') {
  await migrate(getDb(), { migrationsFolder: './migrations' });
}

await server.listen({ port: config.PORT, host: '0.0.0.0' });

server.log.info({ port: config.PORT }, 'Server started');

async function shutdown(signal: string): Promise<void> {
  server.log.info({ signal }, 'Shutdown signal received');

  const forceExit = setTimeout(() => {
    server.log.error('Graceful shutdown timed out after 10 s — force exiting');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    server.server.closeIdleConnections();
    await server.close();

    // Tear down resources in reverse init order
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
| `migrate()` after `initDb()` | Needs a live pool, so it can't run in `loadApp()` (no DB access there) or before `initDb()`. Runs before `listen()` so the process never accepts traffic against an unmigrated schema. `NODE_ENV=test` never runs `server.ts` at all, but the guard makes the intent explicit. |
| `closeIdleConnections()` | HTTP/1.1 keep-alive clients hold sockets open between requests. `server.close()` only stops new accepts — idle sockets never finish on their own, so without this it hangs forever. |
| `await server.close()` | Drains in-flight requests; resolves once all active connections finish or are destroyed. |
| `await closeDb()` | Returns the pool to the OS. After `server.close()` so no request is still mid-query. |
| `process.exit(0)` | Explicit exit prevents stray async callbacks or timers from re-entering after teardown. |
| Force-exit timer | Safety net for stalled teardown — if a connection never closes, the 10 s timer guarantees termination so the orchestrator can restart the pod. Started when shutdown begins, not at process start. |
| `forceExit.unref()` | Stops the timer itself from holding the event loop open, so clean teardown exits immediately instead of waiting out the full 10 s. |
| SIGTERM + SIGINT | SIGTERM is the orchestrator signal (K8s, systemd, Docker); SIGINT is Ctrl-C in dev. Same handler for both. |

Why `initDb()` sits outside `loadApp()` at all: `reference/service-database.md`, "Startup Sequence".

---

## Multiple Resources

Add in init order; tear down in reverse — each following the `initX`/`closeX`/`getX` contract
from `code-standards.md`:

```typescript
await initDb();       // init 1
await initRedis();    // init 2

// In shutdown():
await closeRedis();   // reverse: 2 first
await closeDb();      // reverse: 1 last
```

---

## Kubernetes Pod Termination

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

```yaml
# deployment.yaml
spec:
  terminationGracePeriodSeconds: 20   # outer K8s deadline — must exceed our 10 s timer
                                      # + preStop duration + a few seconds margin
  containers:
    - lifecycle:
        preStop:
          exec:
            command: ["sleep", "5"]   # delay SIGTERM so kube-proxy finishes updating
                                      # iptables before the server stops accepting
```

**Sizing rule:** `terminationGracePeriodSeconds` > `forceExitMs / 1000` + `preStop duration` +
3 s margin. With the defaults above: `20 > 10 + 5 + 3`. Set it ≤ 10 s and K8s sends SIGKILL
before the force-exit timer fires, masking the timeout log and losing the `exit(1)` record.

**Why `preStop: sleep`:** after SIGTERM is sent, kube-proxy takes 1–5 s to propagate the pod's
removal from iptables rules. During that window new connections still route here, so a server
that stops accepting immediately hands them `ECONNREFUSED`. The sleep stalls SIGTERM delivery
by that same window so routing settles before draining starts.
