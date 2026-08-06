# TypeScript REST API — Implementation Templates

Concrete infrastructure layer: Drizzle repository, service business logic, Zod schemas, and
Fastify route plugins. These files depend on external frameworks (Drizzle, Pino, Fastify, Zod).

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

    // rows[0] is safe under noUncheckedIndexedAccess because the ternary guards undefined
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

> This is the one canonical `DrizzleWorkItemRepository`. Never expose raw Drizzle row types
> outside the repository — reconstitute domain objects at the boundary so callers never see DB
> internals.

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

> These are the simple, single-call cases: the service passes `getDb()` straight through. A
> use case spanning two repositories owns a transaction instead — `getDb().transaction(tx =>
> ...)`, see `reference/service-database.md`.
> Log at `warn` for expected failures (not found), `info` for mutations, `debug` for reads.
> Unexpected DB exceptions propagate untouched to `typedErrorMapper` → 500 envelope.

---

## Schemas — `src/validation-schema/work-items.schema.ts`

One file per feature, `*Schema` naming, inferred types exported alongside. This is the single
home for a feature's Zod schemas whether Fastify validates them automatically (as here) or a
handler calls `.safeParse()` manually (`reference/service-errors.md`, "Two Accepted Validation
Shapes").

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

> The exported inferred types are for call sites outside Fastify's own inference (a client SDK,
> a non-route consumer). Route handlers never need them — `fastify-type-provider-zod` infers
> `request.body`/`request.params` from the schemas passed into `{ schema: {...} }`.

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

// Factory — injects dependencies, returns a Fastify plugin. FastifyPluginCallbackZod (sync,
// done()) because registration only calls app.get/post/delete; `async` with nothing to await
// triggers @typescript-eslint/require-await.
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
        // service throws NotFoundError if missing — typedErrorMapper returns the 404
        // envelope AND logs it; the summary line below only runs on the success path.
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
        // Structured-log accumulator — build fields as the handler runs, emit one line at
        // the end. A throw skips this line entirely; typedErrorMapper logs it instead.
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

        await service.delete(id);

        request.log?.info(logFields, 'operation completed');
        return reply.status(204).send();
      },
    );

    done();
  };
}
```

> No `statusFor()`, no `ProblemDetailsSchema`, no inline `reply.status(4xx).send({...})` —
> handlers throw, or let the service throw, and `typedErrorMapper` owns status + envelope.
>
> **The `logFields` accumulator is additive**, not a replacement for the service's own
> `debug`/`warn`/`info` calls: it's a per-request summary at the HTTP boundary. Keep the shape
> consistent across handlers even where a trivial `GET` has little to add. `request.log` is
> always defined on a real Fastify request — the `?.` is defensive, for a route function
> exercised outside one in a lighter test harness.
>
> **Deps shape:** a typed deps object (`WorkItemsRouterDeps`) is the standard for any router,
> so tests can substitute a fake `service`. The single exception is a router with exactly one
> dependency, which takes it positionally — `createHealthRouter(checkDb)` below.

---

## Health Router — `src/routes/health.ts`

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
    // Root — not a K8s probe: external uptime monitors, load balancer default health
    // checks, and a human opening the base URL all hit `/` first. Same "no dependency"
    // answer as liveness, so it lives here rather than in a second factory.
    app.get('/', () => ({ status: 'ok', version: APP_VERSION }));

    // Liveness — is the process alive? Never touches the DB: if the DB is briefly
    // unreachable the process should NOT be killed and restarted, that just adds
    // pod-churn on top of a DB outage.
    app.get('/live', () => ({ status: 'ok', version: APP_VERSION }));

    // Startup — has the process finished booting? Same answer as liveness; K8s uses a
    // separate probe so it can apply a longer initial grace period before liveness
    // starts enforcing its tighter failure threshold.
    app.get('/startup', () => ({ status: 'ok', version: APP_VERSION }));

    // Readiness — can this instance serve traffic right now? Awaits the real dependency.
    // A false tells the load balancer to stop routing here WITHOUT restarting the pod;
    // it rejoins rotation once checkDb() succeeds again.
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

> `checkDb` is injected, never imported — `createHealthRouter` doesn't touch `db.js`, so a test
> passes a fake (`async () => false`) with no module mocking. The real implementation is in
> `src/db.ts` (`reference/service-database.md`).
> The 503 body deliberately does **not** use `ErrorEnvelope`: probes are consumed by the
> orchestrator's HTTP client, not by application error-handling code, and nothing is thrown
> here so `typedErrorMapper` is never involved.
> Mounted unprefixed and outside every plugin — see `reference/service-app.md`, "Middleware /
> Plugin Wiring Order", for why probes stay clear of versioning, auth, and rate limits.
