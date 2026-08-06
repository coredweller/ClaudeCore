# TypeScript REST API — App Wiring (`loadApp()`, Middleware Order, Logger)

## Purpose

This file covers everything inside the Fastify app factory: the `loadApp()` implementation,
the fixed order plugins/hooks/handlers must register in, and the Pino logger configuration.
For the process entry point (`server.ts` — resource init, `listen()`, graceful shutdown),
see `reference/service-lifecycle.md`. For `ExtendableError`/`typedErrorMapper` internals,
see `reference/service-errors.md`.

---

## src/logger.ts — Shared Logger Singleton

One Pino instance for the entire process. Fastify wraps it per-request via `request.log` (a
child logger with a request id bound in); any module-scope code that runs outside a request —
`db.ts`'s pool error listener, `metrics.ts`'s DogStatsD error handler, `server.ts`'s
startup/shutdown lines — imports this directly instead of each constructing its own.

```typescript
// src/logger.ts
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty' }
      : undefined,
});
```

> A single shared instance — not one per module — means every log line in the process (request
> logs, startup/shutdown lines, pool errors, metrics errors) goes through the same level filter
> and the same transport, so dev output is uniformly `pino-pretty` and production output is
> uniformly structured JSON. Two independently-constructed Pino instances reading the same
> `config.LOG_LEVEL` would behave identically today but silently diverge the moment one of them
> needs a different option — one shared export removes that failure mode entirely.

---

## src/app.ts — Full Implementation

```typescript
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { logger } from './logger.js';
import { checkDb } from './db.js';
import { DrizzleWorkItemRepository } from './repositories/work-item.repository.js';
import { WorkItemService } from './services/work-item.service.js';
import type { IWorkItemService } from './services/work-item.service.interface.js';
import { createWorkItemsRouter } from './routes/work-items.js';
import { createHealthRouter } from './routes/health.js';
import { registerErrorMapper } from './middleware/typedErrorMapper.js';
import { ReasonCode } from './errors/codes.js';
import type { ErrorEnvelope } from './errors/types.js';

// Optional deps allow tests to inject stub implementations without vi.mock()
interface AppDeps {
  service?: IWorkItemService;
}

// No resource access here — initDb() runs in server.ts, after this factory returns.
// Integration tests call loadApp() directly and never touch the database (see
// reference/service-lifecycle.md, "Startup Sequence").
export async function loadApp(deps: AppDeps = {}) {
  // loggerInstance, not logger — Fastify v5 throws FST_ERR_LOG_INVALID_LOGGER_CONFIG if a
  // pre-built Pino instance is passed via `logger` (that option accepts only a config object
  // for Fastify to construct its own instance from). `logger.ts`'s shared singleton is exactly
  // the pre-built-instance case, so it must go through `loggerInstance`.
  const app = Fastify({ loggerInstance: logger });

  // ── Type provider ──────────────────────────────────────────────────────────
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // ── Plugins (cross-cutting, app-wide) ──────────────────────────────────────
  await app.register(sensible);
  // A CORS/helmet/rate-limit/auth plugin, if the service needs one, registers here —
  // see "Middleware / Plugin Wiring Order" below for exactly where and why.

  // ── 404 + error handler ────────────────────────────────────────────────────
  // setNotFoundHandler first, then registerErrorMapper — see reference/service-errors.md
  // for the full ErrorEnvelope/ExtendableError model. No ad-hoc reply.status(4xx).send({...})
  // anywhere in this file — that's the named anti-pattern; typedErrorMapper owns every status.
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      message: `Route ${request.method}:${request.url} not found`,
      reason_code: ReasonCode.NotFound,
    } satisfies ErrorEnvelope);
  });
  registerErrorMapper(app);

  // ── Dependencies ───────────────────────────────────────────────────────────
  // DrizzleWorkItemRepository takes no db — db is injected per call by the service
  // (see reference/service-database.md, "Repository Signatures — DbClient Pattern").
  const repository = new DrizzleWorkItemRepository(app.log);
  const service = deps.service ?? new WorkItemService(repository, app.log);

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(createWorkItemsRouter({ service }), { prefix: '/api/v1' });

  // ── Health probes ──────────────────────────────────────────────────────────
  // Unprefixed (/live, /ready, /startup) — deliberately NOT under /api/v1. See
  // "Middleware / Plugin Wiring Order" below for why probes stay outside
  // API versioning/auth/business middleware. checkDb is injected, not imported directly,
  // so createHealthRouter itself never touches db.ts.
  await app.register(createHealthRouter(checkDb));

  return app;
}
```

> `loadApp()` is exported so both `server.ts` and integration tests can build a fully-wired
> Fastify instance without ever touching the database. This is the naming this skill's other
> reference files (`service-database.md`, `service-lifecycle.md`, `SKILL.md`) already assume —
> `app.ts`/`loadApp()`, not `main.ts`/`buildApp()`.
> `createWorkItemsRouter({ service })` — deps as an object even though there's only one field
> today — matches `WorkItemsRouterDeps`; `createHealthRouter(checkDb)` takes its one dependency
> positionally instead, per the single-dependency exception documented alongside it.

---

## Middleware / Plugin Wiring Order

`loadApp()` has one correct registration order. Everything before `registerErrorMapper(app)`
runs without error-envelope protection; everything before the routes affects every route
uniformly.

```
1. Fastify({ loggerInstance })                  ← instance wired to the shared logger.ts singleton
2. setValidatorCompiler / setSerializerCompiler  ← Zod type provider
3. App-wide plugins (sensible, cors, helmet,      ← cross-cutting concerns; order among
   rate-limit, auth/JWT, ...)                       these follows each plugin's own docs
                                                     (e.g. CORS before rate-limit if rate-limit
                                                     keys on a header CORS would strip)
4. setNotFoundHandler                            ← before registerErrorMapper
5. registerErrorMapper(app)                      ← before routes; last "global" registration
6. Dependency construction (repos/services)
7. Feature routers, e.g. register(createFooRouter(deps), { prefix })
8. Health router (createHealthRouter) — unprefixed, LAST
```

**Why this order, not another:**

- **Validator/serializer compiler before any plugin or route** — Fastify resolves the type
  provider per-schema at route registration time. Registering it after routes means the
  first routes registered would validate with Fastify's default (non-Zod) behavior.
- **App-wide plugins before the error handler** — `sensible`, CORS, helmet, rate-limit, and
  auth guards decorate `reply`/`request` or add hooks that routes and the error handler both
  rely on. A plugin registered after `registerErrorMapper` can still run for routes (Fastify
  hooks apply per-route regardless of file order within the same encapsulation context), but
  registering it before keeps the file readable as "global setup, then handlers, then
  features" — don't fight this by scattering plugin registration between route blocks.
- **`setNotFoundHandler` before `registerErrorMapper`** — both are global handlers Fastify
  only allows one of; order between these two specific calls doesn't change behavior, but
  this skill fixes it so 404-vs-thrown-error handling reads top-to-bottom as "no route
  matched" → "route matched, threw."
- **`registerErrorMapper` before routes** — a route registered before the error mapper would
  still be covered (Fastify's `setErrorHandler` applies globally once set, independent of
  registration order), but registering it first means every route file can be written and
  reviewed assuming error handling already exists — there's never a window where a route
  exists without one.
- **Auth guards as a hook, not per-route logic** — if the service needs auth, add it as a
  `preHandler` hook on the plugin/prefix that needs it (`app.register(authPlugin)` wrapping
  just the protected routes, or `app.addHook('preHandler', verifyAuth)` scoped to a child
  context) — never as an `if` at the top of each handler. This keeps auth enforcement
  auditable in one place instead of duplicated per route.
- **Health router last, unprefixed, outside every other plugin** — `/live`, `/ready`,
  `/startup` must never depend on CORS, rate-limiting, or auth. An orchestrator's liveness
  probe has no `Origin` header, no auth token, and must not be rate-limited alongside real
  traffic. Registering it as its own `app.register(createHealthRouter(checkDb))` call —
  not nested inside the `/api/v1` prefix or any auth-wrapped plugin — is what guarantees
  that isolation; see `reference/service-implementation.md`, "Health Router".

### Hooks (`onRequest` / `preValidation` / `preHandler` / `onSend`)

Fastify runs hooks in this fixed order for every request: `onRequest` → `preParsing` →
`preValidation` → (schema validation) → `preHandler` → (handler) → `preSerialization` →
`onSend` → `onResponse`. When adding cross-cutting behavior, pick the earliest hook that can
do the job — don't do in `preHandler` what `onRequest` already covers:

| Hook | Use for |
|------|---------|
| `onRequest` | Auth token presence check, request ID assignment — before body parsing |
| `preValidation` | Mutating the payload before Zod schema validation runs |
| `preHandler` | Auth authorization (role/permission check) — after validation, before the handler runs |
| `onSend` | Response header injection (e.g. a correlation ID) — after serialization, before the socket write |

### Plugin Encapsulation

Fastify plugins are encapsulated by default: decorators, hooks, and configuration registered
inside `app.register(childPlugin)` are **not** visible outside that child context, and a
child's `register()` calls don't leak into siblings. This is why `createFooRouter(deps)` is
registered as a plugin with a `prefix` rather than routes being added directly on `app` —
each feature router gets its own encapsulation boundary. If a decorator or hook genuinely
needs to be visible app-wide (not just within one feature's prefix), the plugin that defines
it must be wrapped with `fastify-plugin` (`fp(plugin)`) — otherwise it silently stays scoped
to its own child context and routes outside it won't see it.

```typescript
// ❌ Auth check duplicated per handler
app.get('/workitems/:id', async (request, reply) => {
  if (!request.headers.authorization) return reply.status(401).send(...);
  // ...
});

// ✅ Auth as a scoped preHandler hook — one place, applies to every route in this context
async function authRouter(app: FastifyInstance) {
  app.addHook('preHandler', verifyAuth);
  await app.register(createWorkItemsRouter({ service }), { prefix: '/api/v1' });
}
await app.register(authRouter);

// ❌ Health router nested inside the auth-wrapped/prefixed context — probes now require a token
await app.register(authRouter); // contains createHealthRouter — WRONG, couples probes to auth

// ✅ Health router registered standalone, outside any auth/prefix wrapper
await app.register(createHealthRouter(checkDb));
```

---

## Logger (Pino)

Fastify's built-in logger is Pino — no separate logging library is added. It is **not**
constructed inside `loadApp()`: `src/logger.ts` (above) builds the one process-wide instance,
and `loadApp()` hands it to Fastify via `loggerInstance`. Anything that needs to log outside a
request — `db.ts`, `metrics.ts`, `server.ts` — imports `logger` from `./logger.js` directly
instead of reading it off `app`/`request`, which don't exist yet at their point of use (or, for
`db.ts`/`metrics.ts`, never exist at all — they're plain modules, not route handlers).

- **`level` comes from `config.LOG_LEVEL`** (`trace`/`debug`/`info`/`warn`/`error`/`fatal`,
  validated by the Zod env schema in `reference/service-config.md`) — never hardcode a level.
- **`pino-pretty` only in development.** Staging/production emit structured JSON so log
  aggregators (Datadog, CloudWatch, ELK) can parse fields — `pino-pretty`'s human-readable
  output is not machine-parseable and must never run outside local dev.
- **Use `request.log` inside routes and services; `logger` (from `./logger.js`) everywhere
  else.** Fastify attaches a child logger per request (`request.log`) that's pre-bound with a
  request ID — `request.log.info({ workItemId }, 'message')`. This is what lets two concurrent
  requests' logs be told apart in aggregated output. The shared `logger` singleton (`app.log`
  is the same instance, reachable once `loadApp()` has returned) is the right choice for
  startup/shutdown lines and any module-scope code with no request in scope — see
  `reference/service-lifecycle.md`'s `server.ts`, `reference/service-database.md`'s pool error
  listener, and `reference/service-observability.md`'s DogStatsD error handler.
- **Structured, not interpolated.** `request.log.info({ workItemId }, 'message')` — the
  object is the first argument; never `request.log.info(\`Item ${id} created\`)`. Interpolated
  strings can't be queried by field in a log aggregator.
- **Never log `config` directly** — always `getProperties()` (see `reference/service-config.md`)
  so `sensitive: true` fields (e.g. `DATABASE_URL`) are redacted before they reach a log line.

---

## Entry Point (`server.ts`)

`server.ts` is the process entry point — the only file that calls `loadApp()`, initializes
resources, and starts listening. Summary of the sequence (full implementation, SIGTERM/SIGINT
handler, force-exit timer, and Kubernetes termination guidance: `reference/service-lifecycle.md`):

```
server.ts
  1. const server = await loadApp()          ← registers plugins + routes; zero resource access
  2. await initDb()                          ← pool created, TLS configured, pool.connect() verified
  3. await migrate(getDb(), {...})           ← pending migrations, skipped when NODE_ENV=test
  4. await server.listen(...)                ← starts accepting HTTP traffic
  5. SIGTERM/SIGINT → drain, close resources in reverse init order, process.exit(0)
     [10 s force-exit timer, unref'd, fires exit(1) if teardown stalls]
```

**Why `loadApp()` and `server.ts` are separate files:** integration tests call `loadApp()`
directly with stub services and never touch the database or the network. If resource init
lived inside `loadApp()` itself, every test would require a live DB connection.
