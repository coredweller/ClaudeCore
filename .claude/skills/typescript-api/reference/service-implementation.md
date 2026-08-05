# TypeScript REST API — Implementation Templates

Concrete infrastructure layer: Drizzle ORM repository, service business logic, and Fastify route plugin.
These files depend on external frameworks (Drizzle, Pino, Fastify, Zod).

---

## Drizzle Repository — `src/repositories/work-item.repository.ts`

```typescript
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DbClient } from '../db.js';
import {
  reconstituteWorkItem,
  type WorkItem,
  type WorkItemId,
} from '../domain/work-item.js';
import { workItems } from '../schema/work-items.schema.js';
import type { IWorkItemRepository } from './work-item.repository.interface.js';

export class DrizzleWorkItemRepository implements IWorkItemRepository {
  constructor(private readonly log: Logger) {}
  // No db field — db is injected per call, enabling transparent TX participation
  // (see reference/service-database.md, "Repository Signatures — DbClient Pattern").

  async findAll(db: DbClient): Promise<readonly WorkItem[]> {
    this.log.debug('Fetching all work items');
    const rows = await db
      .select()
      .from(workItems)
      .orderBy(workItems.createdAt);
    return rows.map((r) => reconstituteWorkItem(r.id, r.title, r.createdAt));
  }

  async findById(db: DbClient, id: WorkItemId): Promise<WorkItem | null> {
    const rows = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);

    const row = rows[0];
    return row ? reconstituteWorkItem(row.id, row.title, row.createdAt) : null;
  }

  async save(db: DbClient, item: WorkItem): Promise<WorkItem> {
    this.log.debug({ workItemId: item.id }, 'Saving work item');
    await db.insert(workItems).values({
      id: item.id,
      title: item.title,
      createdAt: item.createdAt,
    });
    return item;
  }

  async deleteById(db: DbClient, id: WorkItemId): Promise<boolean> {
    const deleted = await db
      .delete(workItems)
      .where(eq(workItems.id, id))
      .returning({ id: workItems.id });
    return deleted.length > 0;
  }
}
```

> This is the ONE canonical `DrizzleWorkItemRepository` — `reference/service-database.md`
> points here rather than keeping its own copy, so the two can't drift apart again.
> Never expose raw Drizzle row types outside the repository. Reconstitute domain objects
> at the repository boundary — callers never see DB internals.
> `rows[0]` is safe under `noUncheckedIndexedAccess` because the ternary guards `undefined`.
> `db: DbClient` as the first parameter on every method (not a constructor-injected `Db`) is
> what lets the service pass either the pool-level `Db` or an active `tx` — see
> `reference/service-database.md` for the non-negotiable rule and why a constructor-injected
> `Db` field breaks transaction participation.

---

## Service — `src/services/work-item.service.ts`

```typescript
import type { Logger } from 'pino';
import { createWorkItem, type WorkItemId, type WorkItem } from '../domain/work-item.js';
import { NotFoundError, DomainValidationError } from '../errors/domain.js';
import { getDb } from '../db.js';
import type { IWorkItemRepository } from '../repositories/work-item.repository.interface.js';
import type { IWorkItemService } from './work-item.service.interface.js';

export class WorkItemService implements IWorkItemService {
  constructor(
    private readonly repository: IWorkItemRepository,
    private readonly log: Logger,
  ) {}

  async listAll(): Promise<readonly WorkItem[]> {
    this.log.debug('Listing all work items');
    return this.repository.findAll(getDb());
  }

  async getById(id: WorkItemId): Promise<WorkItem> {
    const item = await this.repository.findById(getDb(), id);

    if (!item) {
      this.log.warn({ workItemId: id }, 'Work item not found');
      throw new NotFoundError('WorkItem', id);
    }

    return item;
  }

  async create(title: string): Promise<WorkItem> {
    if (!title.trim()) {
      throw new DomainValidationError('Title must not be blank.');
    }

    const item = createWorkItem(title);
    await this.repository.save(getDb(), item);

    this.log.info({ workItemId: item.id, title: item.title }, 'Work item created');
    return item;
  }

  async delete(id: WorkItemId): Promise<void> {
    const deleted = await this.repository.deleteById(getDb(), id);

    if (!deleted) {
      this.log.warn({ workItemId: id }, 'Delete failed — work item not found');
      throw new NotFoundError('WorkItem', id);
    }

    this.log.info({ workItemId: id }, 'Work item deleted');
  }
}
```

> Services throw custom error classes (`NotFoundError`, `DomainValidationError`) — not return `Result<T>`.
> Thrown errors propagate through the route handler to `typedErrorMapper`, which sets status + envelope.
> Unexpected DB exceptions also propagate to `typedErrorMapper` → 500 envelope.
> Log at `warn` for expected failures (not found), `info` for mutations, `debug` for reads.

---

## Schemas — `src/validation-schema/work-items.schema.ts`

One file per feature, `*Schema` naming, inferred types exported alongside. This is the single
home for a feature's Zod schemas whether Fastify validates them automatically (as here) or a
handler calls `.safeParse()` manually (see `reference/service-errors.md`, "Two Accepted
Validation Shapes") — either way, raw Zod stays out of the route file body.

> `validation-schema/` (this directory) holds Zod schemas for the HTTP layer.
> `schema/` (see `reference/service-database.md`) holds Drizzle table definitions for the DB
> layer. Both happen to use a file named `work-items.schema.ts` — same feature, two different
> layers, deliberately distinct directory names so the import path itself says which one you're
> in (`from '../validation-schema/work-items.schema.js'` vs `from '../schema/work-items.schema.js'`).

```typescript
import { z } from 'zod';

export const WorkItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.date(),
});
export type WorkItemDto = z.infer<typeof WorkItemSchema>;

export const ListWorkItemsResponseSchema = z.array(WorkItemSchema);

export const CreateWorkItemSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must not exceed 200 characters'),
});
export type CreateWorkItemDto = z.infer<typeof CreateWorkItemSchema>;

export const WorkItemIdParamSchema = z.object({
  id: z.string().uuid('Invalid work item ID format'),
});
export type WorkItemIdParamDto = z.infer<typeof WorkItemIdParamSchema>;
```

> Exported inferred types (`WorkItemDto`, `CreateWorkItemDto`, ...) are for call sites outside
> Fastify's own type-provider inference (e.g. a client SDK, a non-route consumer) — route
> handlers never need them explicitly, `fastify-type-provider-zod` infers `request.body` /
> `request.params` from the schema passed into `{ schema: {...} }` directly.

---

## Router — `src/routes/work-items.ts`

```typescript
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { workItemIdFrom } from '../domain/work-item.js';
import type { IWorkItemService } from '../services/work-item.service.interface.js';
import {
  WorkItemSchema,
  ListWorkItemsResponseSchema,
  CreateWorkItemSchema,
  WorkItemIdParamSchema,
} from '../validation-schema/work-items.schema.js';

export interface WorkItemsRouterDeps {
  service: IWorkItemService;
}

// ── Factory — injects dependencies, returns a Fastify plugin ─────────────────
// Uses FastifyPluginCallbackZod (sync) because registration only calls app.get/post/delete —
// no awaiting during setup. Using async here triggers @typescript-eslint/require-await.
// Deps as a typed object (not positional params) — this is the standard shape for every
// DB-backed router: tests substitute a fake `service` here without touching the real one.
export function createWorkItemsRouter(deps: WorkItemsRouterDeps): FastifyPluginCallbackZod {
  const { service } = deps;

  return function (app, _opts, done) {
    // GET /workitems
    app.get(
      '/workitems',
      { schema: { response: { 200: ListWorkItemsResponseSchema } } },
      async (request) => {
        const items = await service.listAll();

        request.log?.info({ operation: 'listWorkItems', count: items.length }, 'operation completed');
        return items;
      },
    );

    // GET /workitems/:id
    app.get(
      '/workitems/:id',
      { schema: { params: WorkItemIdParamSchema, response: { 200: WorkItemSchema } } },
      async (request) => {
        const id = workItemIdFrom(request.params.id);
        // service throws NotFoundError if missing — typedErrorMapper returns 404 envelope
        // AND logs it; the accumulator log below only runs on the success path.
        const item = await service.getById(id);

        request.log?.info({ operation: 'getWorkItem', workItemId: id }, 'operation completed');
        return item;
      },
    );

    // POST /workitems
    app.post(
      '/workitems',
      { schema: { body: CreateWorkItemSchema, response: { 201: WorkItemSchema } } },
      async (request, reply) => {
        // ── Structured-log accumulator — build fields as the handler runs, one log line ──
        // at the end. Errors thrown by service.create() skip this line entirely; they're
        // logged once by typedErrorMapper instead — never both.
        const logFields: Record<string, unknown> = { operation: 'createWorkItem' };

        const item = await service.create(request.body.title);
        logFields['workItemId'] = item.id;
        logFields['title'] = item.title;

        request.log?.info(logFields, 'operation completed');
        return reply.status(201).send(item);
      },
    );

    // DELETE /workitems/:id
    app.delete(
      '/workitems/:id',
      { schema: { params: WorkItemIdParamSchema, response: { 204: z.undefined() } } },
      async (request, reply) => {
        const logFields: Record<string, unknown> = { operation: 'deleteWorkItem' };
        const id = workItemIdFrom(request.params.id);
        logFields['workItemId'] = id;

        // service throws NotFoundError if missing — typedErrorMapper returns 404 envelope
        await service.delete(id);

        request.log?.info(logFields, 'operation completed');
        return reply.status(204).send();
      },
    );

    done();
  };
}
```

> No `statusFor()`, no `ProblemDetailsSchema`, no inline `reply.status(4xx).send({...})`.
> Handlers throw or let the service throw — `typedErrorMapper` owns status + envelope.
> `createWorkItemsRouter(deps)` captures `deps.service` in a closure and returns a
> `FastifyPluginCallbackZod`. The callback pattern (`done()`) is used instead of `async`
> because route registration is synchronous; `async` with no `await` triggers
> `@typescript-eslint/require-await`.
>
> **Structured-log accumulator** (additive to service-level logging, not a replacement — the
> service keeps its own `debug`/`warn`/`info` calls from the section above): build a typed
> `logFields` object at handler entry, add to it as the handler progresses, and emit exactly
> one `request.log?.info(logFields, 'operation completed')` at the end of the success path.
> This is a per-request summary line for the route layer, distinct from the service's own
> lower-level traces — use it on handlers where a single "here's what happened" line at the
> HTTP boundary is valuable; a trivial single-branch `GET` doesn't need much in `logFields`,
> but the shape stays consistent across every handler regardless. `request.log` is always
> defined on a Fastify request (`?.` is defensive, not load-bearing) — kept for the case where
> a route function is exercised outside a real Fastify request in a lighter test harness.
> `deps: WorkItemsRouterDeps` (not a positional `service` param) is the general shape for any
> router with one or more DB-backed dependencies — see `createHealthRouter` below for the
> single-dependency exception, where the factory takes that one dependency positionally
> instead of wrapping it in a one-field deps object.

---

## Health Router — `src/routes/health.ts`

Three K8s probes, one factory. `checkDb` is the only dependency, so it's a positional
parameter — not wrapped in a deps object the way `WorkItemsRouterDeps` is for routers with
one or more DB-backed dependencies.

```typescript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

// Read once at module load — package.json doesn't change at runtime, so this isn't a
// resource with an init/close lifecycle (see code-standards.md's Resource Lifecycle contract).
const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const APP_VERSION = (JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string }).version;

type CheckDbFn = () => Promise<boolean>;

export function createHealthRouter(checkDb: CheckDbFn): FastifyPluginCallbackZod {
  return function (app, _opts, done) {
    // Liveness — is the process itself alive? Never touches the DB: if the DB is briefly
    // unreachable, the process should NOT be killed and restarted — that doesn't fix a DB
    // outage, it just adds pod-churn on top of it.
    app.get('/live', () => ({ status: 'ok', version: APP_VERSION }));

    // Startup — has the process finished booting? Same "no dependency" answer as liveness;
    // K8s uses a separate probe so it can apply a longer initial grace period before
    // liveness starts enforcing its (usually tighter) failure threshold.
    app.get('/startup', () => ({ status: 'ok', version: APP_VERSION }));

    // Readiness — can this instance actually serve traffic right now? Awaits the real
    // dependency. A false here tells the load balancer to stop routing traffic to this pod
    // WITHOUT restarting it — the pod rejoins rotation once checkDb() succeeds again.
    app.get('/ready', async (request, reply) => {
      const ready = await checkDb();

      if (!ready) {
        request.log.warn('Readiness check failed — database unreachable');
        return reply.status(503).send({ status: 'not_ready' });
      }

      return { status: 'ok' };
    });

    done();
  };
}
```

> Mounted unprefixed (`/live`, `/ready`, `/startup`) — not under `/api/v1` — see
> `reference/service-config.md`, `src/app.ts`. K8s probes shouldn't depend on API versioning,
> auth, or any business-route middleware; keeping them outside the prefix means a future
> change to `/api/v1` (auth requirement, rate limiting, a version bump) can never accidentally
> break the probes an orchestrator restarts the pod over.
> `checkDb` is injected, not imported — `createHealthRouter` never imports `getDb`/`db.js`
> directly, so a test can pass a fake `checkDb` (`async () => false`) without any DB module
> mocking. The real implementation lives in `src/db.ts` — see `reference/service-database.md`.
> The 503 body on a failed readiness check deliberately does NOT use `ErrorEnvelope` — probes
> are consumed by the orchestrator's HTTP client, not application error-handling code, and
> don't go through `typedErrorMapper` since nothing is thrown here.
