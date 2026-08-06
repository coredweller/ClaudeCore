# TypeScript REST API — App Wiring (`loadApp()`, Middleware Order, Logger)

Everything inside the Fastify app factory: the `loadApp()` implementation, the fixed order
plugins/hooks/handlers register in, and the Pino logger configuration.

For the process entry point (`server.ts` — resource init, `listen()`, graceful shutdown) see
`reference/service-lifecycle.md`; for `ExtendableError`/`typedErrorMapper` internals see
`reference/service-errors.md`.

---

## src/logger.ts — Shared Logger Singleton

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

Fastify's built-in logger *is* Pino — no separate logging library is added. The instance is
built here, not inside `loadApp()`, so that every log line in the process goes through the same
level filter and transport.

- **`request.log` inside routes and services; `logger` everywhere else.** Fastify attaches a
  per-request child logger pre-bound with a request id — that's what lets two concurrent
  requests' lines be told apart in aggregated output. Module-scope code has no request in
  scope and imports `logger` directly: `db.ts`'s pool error listener, `metrics.ts`'s DogStatsD
  error handler, `server.ts`'s startup/shutdown lines. (`app.log` is this same instance, once
  `loadApp()` has returned.)
- **`level` comes from `config.LOG_LEVEL`** — never hardcode a level.
- **`pino-pretty` only in development.** Staging/production emit structured JSON so aggregators
  (Datadog, CloudWatch, ELK) can parse fields; pretty output is not machine-parseable.
- **Structured, not interpolated.** `request.log.info({ workItemId }, 'message')` — object
  first. Never `` request.log.info(`Item ${id} created`) ``; interpolated strings can't be
  queried by field.
- **Never log `config` directly** — always `getProperties()` (`reference/service-config.md`) so
  `sensitive: true` fields are redacted before reaching a log line.

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

// No resource access here — initDb() runs in server.ts, after this factory returns
// (see reference/service-database.md, "Startup Sequence").
export async function loadApp(deps: AppDeps = {}) {
  // loggerInstance, not logger — Fastify v5 throws FST_ERR_LOG_INVALID_LOGGER_CONFIG if a
  // pre-built Pino instance is passed via `logger` (that option accepts only a config object
  // for Fastify to construct its own instance from).
  const app = Fastify({ loggerInstance: logger });

  // ── Type provider ──────────────────────────────────────────────────────────
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // ── Plugins (cross-cutting, app-wide) ──────────────────────────────────────
  await app.register(sensible);
  // A CORS/helmet/rate-limit/auth plugin, if the service needs one, registers here —
  // see "Middleware / Plugin Wiring Order" below.

  // ── 404 + error handler ────────────────────────────────────────────────────
  // The only sanctioned reply.status(4xx).send() outside typedErrorMapper: no route
  // matched, so nothing was thrown for the mapper to catch. Uses the same envelope.
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
  // Unprefixed and outside every other plugin — see wiring order below. checkDb is
  // injected, not imported, so createHealthRouter never touches db.ts.
  await app.register(createHealthRouter(checkDb));

  return app;
}
```

> `loadApp()` is exported so both `server.ts` and integration tests can build a fully-wired
> Fastify instance without touching the database. This is the naming the rest of the skill
> assumes — `app.ts`/`loadApp()`, not `main.ts`/`buildApp()`.

---

## Middleware / Plugin Wiring Order

```
1. Fastify({ loggerInstance })                   ← wired to the logger.ts singleton
2. setValidatorCompiler / setSerializerCompiler  ← Zod type provider
3. App-wide plugins (sensible, cors, helmet,     ← order among these follows each plugin's
   rate-limit, auth/JWT, ...)                       own docs (e.g. CORS before rate-limit if
                                                     rate-limit keys on a header CORS strips)
4. setNotFoundHandler
5. registerErrorMapper(app)                      ← last "global" registration
6. Dependency construction (repos/services)
7. Feature routers — register(createFooRouter(deps), { prefix })
8. Health router (createHealthRouter) — unprefixed, LAST
```

**Why this order, not another:**

- **Validator/serializer compiler before any plugin or route** — Fastify resolves the type
  provider per-schema at route registration time. Register it after routes and those routes
  validate with Fastify's default (non-Zod) behavior. This one is load-bearing.
- **Steps 4–7 are convention, not mechanism.** `setErrorHandler` and `setNotFoundHandler` apply
  globally once set, independent of registration order, so a route registered before the mapper
  is still covered. The order is fixed anyway so every file reads top-to-bottom as "global
  setup → handlers → features," and so no route can be written in a window where error handling
  doesn't yet exist. Don't fight it by scattering plugin registration between route blocks.
- **Auth as a hook, not per-route logic** — add it as a `preHandler` on the plugin/prefix that
  needs it, never as an `if` at the top of each handler. Auth enforcement stays auditable in
  one place instead of duplicated per route.
- **Health router last, unprefixed, outside every other plugin** — `/live`, `/ready`,
  `/startup` must never depend on CORS, rate-limiting, or auth. An orchestrator's liveness
  probe has no `Origin` header, no auth token, and must not be rate-limited alongside real
  traffic. Registering it as its own top-level `app.register()` call is what guarantees that
  isolation.

```typescript
// ❌ Auth check duplicated per handler
app.get('/workitems/:id', async (request, reply) => {
  if (!request.headers.authorization) return reply.status(401).send(...);
});

// ✅ Auth as a scoped preHandler hook — one place, every route in this context
async function authRouter(app: FastifyInstance) {
  app.addHook('preHandler', verifyAuth);
  await app.register(createWorkItemsRouter({ service }), { prefix: '/api/v1' });
}
await app.register(authRouter);

// ❌ Health router nested inside that auth-wrapped context — probes now require a token
// ✅ Health router registered standalone
await app.register(createHealthRouter(checkDb));
```

### Hooks

Fastify runs hooks in a fixed order per request: `onRequest` → `preParsing` → `preValidation` →
(schema validation) → `preHandler` → (handler) → `preSerialization` → `onSend` → `onResponse`.
Pick the earliest hook that can do the job — don't do in `preHandler` what `onRequest` covers.

| Hook | Use for |
|------|---------|
| `onRequest` | Auth token presence check, request ID assignment — before body parsing |
| `preValidation` | Mutating the payload before Zod schema validation runs |
| `preHandler` | Authorization (role/permission check) — after validation, before the handler |
| `onSend` | Response header injection (e.g. a correlation ID) — after serialization |

### Plugin Encapsulation

Fastify plugins are encapsulated by default: decorators, hooks, and configuration registered
inside `app.register(childPlugin)` are **not** visible outside that child context, and a child's
`register()` calls don't leak into siblings. That's why each `createFooRouter(deps)` is
registered as a plugin with a `prefix` rather than adding routes directly on `app` — every
feature router gets its own boundary. A decorator or hook that genuinely must be visible
app-wide has to be wrapped with `fastify-plugin` (`fp(plugin)`), or it silently stays scoped to
its own child context.
