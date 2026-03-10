# TypeScript REST API — Implementation Templates

Concrete infrastructure layer: Drizzle ORM repository, service business logic, and Fastify route plugin.
These files depend on external frameworks (Drizzle, Pino, Fastify, Zod).

---

## Drizzle Repository — `src/repositories/work-item.repository.ts`

```typescript
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db.js';
import {
  reconstituteWorkItem,
  type WorkItem,
  type WorkItemId,
} from '../domain/work-item.js';
import { workItems } from '../schema/work-items.schema.js';
import type { IWorkItemRepository } from './work-item.repository.interface.js';

export class DrizzleWorkItemRepository implements IWorkItemRepository {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  async findAll(): Promise<readonly WorkItem[]> {
    this.log.debug('Fetching all work items');
    const rows = await this.db
      .select()
      .from(workItems)
      .orderBy(workItems.createdAt);
    return rows.map((r) => reconstituteWorkItem(r.id, r.title, r.createdAt));
  }

  async findById(id: WorkItemId): Promise<WorkItem | null> {
    const rows = await this.db
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);

    const row = rows[0];
    return row ? reconstituteWorkItem(row.id, row.title, row.createdAt) : null;
  }

  async save(item: WorkItem): Promise<WorkItem> {
    this.log.debug({ workItemId: item.id }, 'Saving work item');
    await this.db.insert(workItems).values({
      id: item.id,
      title: item.title,
      createdAt: item.createdAt,
    });
    return item;
  }

  async deleteById(id: WorkItemId): Promise<boolean> {
    const deleted = await this.db
      .delete(workItems)
      .where(eq(workItems.id, id))
      .returning({ id: workItems.id });
    return deleted.length > 0;
  }
}
```

> Never expose raw Drizzle row types outside the repository. Reconstitute domain objects
> at the repository boundary — callers never see DB internals.
> `rows[0]` is safe under `noUncheckedIndexedAccess` because the ternary guards `undefined`.

---

## Service — `src/services/work-item.service.ts`

```typescript
import type { Logger } from 'pino';
import { createWorkItem, type WorkItemId, type WorkItem } from '../domain/work-item.js';
import { fail, ok, type Result } from '../domain/errors.js';
import type { IWorkItemRepository } from '../repositories/work-item.repository.interface.js';
import type { IWorkItemService } from './work-item.service.interface.js';

export class WorkItemService implements IWorkItemService {
  constructor(
    private readonly repository: IWorkItemRepository,
    private readonly log: Logger,
  ) {}

  async listAll(): Promise<readonly WorkItem[]> {
    this.log.debug('Listing all work items');
    return this.repository.findAll();
  }

  async getById(id: WorkItemId): Promise<Result<WorkItem>> {
    const item = await this.repository.findById(id);

    if (!item) {
      this.log.warn({ workItemId: id }, 'Work item not found');
      return fail({ kind: 'NotFound', id });
    }

    return ok(item);
  }

  async create(title: string): Promise<Result<WorkItem>> {
    if (!title.trim()) {
      return fail({ kind: 'ValidationError', message: 'Title must not be blank.' });
    }

    const item = createWorkItem(title);
    await this.repository.save(item);

    this.log.info({ workItemId: item.id, title: item.title }, 'Work item created');
    return ok(item);
  }

  async delete(id: WorkItemId): Promise<Result<true>> {
    const deleted = await this.repository.deleteById(id);

    if (!deleted) {
      this.log.warn({ workItemId: id }, 'Delete failed — work item not found');
      return fail({ kind: 'NotFound', id });
    }

    this.log.info({ workItemId: id }, 'Work item deleted');
    return ok(true);
  }
}
```

> **Never throw** from services for domain errors. Services return `Result<T>`.
> Unexpected DB exceptions bubble up to the Fastify error handler as 500s.
> Log at `warn` for expected failures (not found), `info` for mutations, `debug` for reads.

---

## Route Plugin — `src/routes/work-items.ts`

```typescript
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { statusFor } from '../domain/errors.js';
import { workItemIdFrom } from '../domain/work-item.js';
import type { IWorkItemService } from '../services/work-item.service.interface.js';

// ── Zod schemas — single source of truth for validation AND serialization ────
const WorkItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.date(),
});

const CreateWorkItemSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must not exceed 200 characters'),
});

const WorkItemIdParamSchema = z.object({
  id: z.string().uuid('Invalid work item ID format'),
});

// ── Factory — injects service dependency, returns a Fastify plugin ───────────
export function workItemsPlugin(service: IWorkItemService): FastifyPluginAsyncZod {
  return async function (app) {
    // GET /workitems
    app.get(
      '/workitems',
      { schema: { response: { 200: z.array(WorkItemSchema) } } },
      async () => service.listAll(),
    );

    // GET /workitems/:id
    app.get(
      '/workitems/:id',
      {
        schema: {
          params: WorkItemIdParamSchema,
          response: {
            200: WorkItemSchema,
            404: z.object({ type: z.string(), title: z.string(), status: z.number(), instance: z.string() }),
          },
        },
      },
      async (request, reply) => {
        const result = await service.getById(workItemIdFrom(request.params.id));

        if (!result.ok) {
          return reply.status(statusFor(result.error)).send({
            type: 'https://tools.ietf.org/html/rfc7807',
            title: `Work item ${request.params.id} not found.`,
            status: 404,
            instance: request.url,
          });
        }

        return result.value;
      },
    );

    // POST /workitems
    app.post(
      '/workitems',
      {
        schema: {
          body: CreateWorkItemSchema,
          response: { 201: WorkItemSchema },
        },
      },
      async (request, reply) => {
        const result = await service.create(request.body.title);

        if (!result.ok) {
          return reply.status(statusFor(result.error)).send({
            type: 'https://tools.ietf.org/html/rfc7807',
            title: result.error.kind === 'ValidationError' ? result.error.message : 'Bad Request',
            status: statusFor(result.error),
            instance: request.url,
          });
        }

        return reply.status(201).send(result.value);
      },
    );

    // DELETE /workitems/:id
    app.delete(
      '/workitems/:id',
      {
        schema: {
          params: WorkItemIdParamSchema,
          response: {
            204: z.undefined(),
            404: z.object({ type: z.string(), title: z.string(), status: z.number(), instance: z.string() }),
          },
        },
      },
      async (request, reply) => {
        const result = await service.delete(workItemIdFrom(request.params.id));

        if (!result.ok) {
          return reply.status(statusFor(result.error)).send({
            type: 'https://tools.ietf.org/html/rfc7807',
            title: `Work item ${request.params.id} not found.`,
            status: 404,
            instance: request.url,
          });
        }

        return reply.status(204).send();
      },
    );
  };
}
```

> Route handlers only map `Result<T>` to HTTP. Business rules live in the service.
> Zod schemas drive both request validation and response serialization — no duplication.
> `workItemsPlugin(service)` is a factory: it captures the service in a closure and
> returns a `FastifyPluginAsyncZod` — registered in `main.ts` via `app.register()`.
