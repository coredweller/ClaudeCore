# TypeScript REST API — Test Templates

Unit tests (service logic, no I/O) and integration tests (full HTTP pipeline via `app.inject()`).

---

## Unit Tests — `test/unit/work-item.service.test.ts`

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { getDb } from '../../src/db.js';
import type { DbClient } from '../../src/db.js';
import type { WorkItem } from '../../src/domain/work-item.js';
import { newWorkItemId, workItemIdFrom } from '../../src/domain/work-item.js';
import { NotFoundError, DomainValidationError } from '../../src/errors/domain.js';
import type { IWorkItemRepository } from '../../src/repositories/work-item.repository.interface.js';
import { WorkItemService } from '../../src/services/work-item.service.js';

// WorkItemService imports and calls getDb() directly (see reference/service-database.md) —
// mock the module so unit tests never need a real connection pool. vi.mock() calls are
// hoisted above imports by Vitest automatically, so declaration order here doesn't matter.
// Importing `getDb` here (not just in the service) resolves to the SAME mocked function —
// that's what lets the beforeEach below re-arm it.
vi.mock('../../src/db.js', () => ({ getDb: vi.fn() }));

// restoreMocks: true (vitest.config.ts) calls vi.restoreAllMocks() before every test, which
// resets a vi.mock()-factory vi.fn() to a no-op returning undefined — there's no "original
// implementation" for it to restore to. Without this beforeEach, only the FIRST test in this
// file would see a real return value from getDb(); every test after it would get undefined
// silently. Re-arm the return value every test rather than relying on the factory's initial
// arrow function to survive. The value is opaque: repository methods are mocked below too, so
// its shape is never inspected — it only has to satisfy the DbClient type.
beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({} as DbClient);
});

// ── Stub repository ──────────────────────────────────────────────────────────
function makeRepository(overrides: Partial<IWorkItemRepository> = {}): IWorkItemRepository {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    // Promise.resolve() not async () => — async without await triggers require-await lint rule
    save: vi.fn().mockImplementation((_db: DbClient, item: WorkItem) => Promise.resolve(item)),
    deleteById: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

const noopLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

// ── listAll ──────────────────────────────────────────────────────────────────
describe('WorkItemService.listAll', () => {
  it('returns all items from repository', async () => {
    const items: WorkItem[] = [
      { id: newWorkItemId(), title: 'Buy milk', createdAt: new Date() },
    ];
    const repository = makeRepository({ findAll: vi.fn().mockResolvedValue(items) });
    const sut = new WorkItemService(repository, noopLog);

    const result = await sut.listAll();

    expect(result).toEqual(items);
    // vi.mocked() wraps the spy with its Mock type — avoids unbound-method lint error
    // when passing a method reference to expect(). eslint.config.js disables
    // @typescript-eslint/unbound-method for test files as a belt-and-suspenders measure.
    expect(vi.mocked(repository.findAll)).toHaveBeenCalledOnce();
  });
});

// ── getById ──────────────────────────────────────────────────────────────────
describe('WorkItemService.getById', () => {
  it('returns the item when found', async () => {
    const item: WorkItem = { id: newWorkItemId(), title: 'Buy milk', createdAt: new Date() };
    const repository = makeRepository({ findById: vi.fn().mockResolvedValue(item) });
    const sut = new WorkItemService(repository, noopLog);

    await expect(sut.getById(item.id)).resolves.toEqual(item);
  });

  it('throws NotFoundError when item does not exist', async () => {
    const repository = makeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const sut = new WorkItemService(repository, noopLog);

    await expect(
      sut.getById(workItemIdFrom('00000000-0000-0000-0000-000000000001')),
    ).rejects.toThrow(NotFoundError);
  });
});

// ── create ───────────────────────────────────────────────────────────────────
describe('WorkItemService.create', () => {
  let repository: IWorkItemRepository;
  let sut: WorkItemService;

  beforeEach(() => {
    repository = makeRepository();
    sut = new WorkItemService(repository, noopLog);
  });

  it('returns created item with trimmed title', async () => {
    const result = await sut.create('  Walk the dog  ');

    expect(result.title).toBe('Walk the dog');
    expect(result.id).toBeDefined();
    // save(db, item) — first arg is the mocked DbClient, second is the item under test
    expect(vi.mocked(repository.save)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'Walk the dog' }),
    );
  });

  it.each(['', '   '])('throws DomainValidationError for blank title "%s"', async (title) => {
    await expect(sut.create(title)).rejects.toThrow(DomainValidationError);
    expect(vi.mocked(repository.save)).not.toHaveBeenCalled();
  });
});

// ── delete ───────────────────────────────────────────────────────────────────
describe('WorkItemService.delete', () => {
  it('resolves when item is deleted', async () => {
    const id = newWorkItemId();
    const repository = makeRepository({ deleteById: vi.fn().mockResolvedValue(true) });
    const sut = new WorkItemService(repository, noopLog);

    await expect(sut.delete(id)).resolves.toBeUndefined();
  });

  it('throws NotFoundError when item does not exist', async () => {
    const repository = makeRepository({ deleteById: vi.fn().mockResolvedValue(false) });
    const sut = new WorkItemService(repository, noopLog);

    await expect(sut.delete(newWorkItemId())).rejects.toThrow(NotFoundError);
  });
});
```

> `WorkItemService` methods either resolve with a value or reject by throwing an
> `ExtendableError` subclass — assert with `.resolves.toEqual(...)` / `.rejects.toThrow(...)`,
> never `result.ok` (that field doesn't exist; the service never returns `Result<T>`).
> `vi.fn()` stubs avoid mocking the logger — logging is a side effect, not a domain concern.
> `noopLog as unknown as Logger` satisfies the full Pino `Logger` type (~40 methods) without
> `as any` (banned by `no-explicit-any`). Only the 4 methods the service uses need to be stubbed.
> `vi.mocked()` wraps spy references before passing to `expect()` — avoids `unbound-method`
> lint errors. `eslint.config.js` also disables `unbound-method` for all test files because
> `vi.fn()` mocks have no real `this` binding concerns.
> Mock implementations use `Promise.resolve()` not `async () =>` — the latter triggers
> `@typescript-eslint/require-await` when there is nothing to await.
> Repository stubs take `db: DbClient` as their first parameter, matching
> `IWorkItemRepository` (see `reference/service-domain.md`) — a stub written with the old
> zero-arg signature fails `tsc`, not silently passes.

---

## Router Unit Tests — `test/unit/work-items.router.test.ts`

`createWorkItemsRouter(deps)` (see `reference/service-implementation.md`) is DI'd, so it can be
mounted directly on a bare Fastify instance with fake deps — no `loadApp()`, no `initDb()`, not
even the real error mapper. This is a lighter, narrower test than the full integration suite
below: it proves the router wires HTTP → service correctly, not that the whole app boots.

```typescript
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { IWorkItemService } from '../../src/services/work-item.service.interface.js';
import { createWorkItemsRouter } from '../../src/routes/work-items.js';
import { createWorkItem } from '../../src/domain/work-item.js';

function makeStubService(overrides: Partial<IWorkItemService> = {}): IWorkItemService {
  return {
    listAll: vi.fn().mockResolvedValue([]),
    getById: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

// No registerErrorMapper here — 500s from an unmapped thrown error are expected and fine;
// this suite only asserts the router calls the right service method with the right args.
async function buildTestApp(service: IWorkItemService) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createWorkItemsRouter({ service }));
  await app.ready();
  return app;
}

describe('createWorkItemsRouter', () => {
  it('GET /workitems calls service.listAll()', async () => {
    const item = createWorkItem('Buy milk');
    const service = makeStubService({ listAll: vi.fn().mockResolvedValue([item]) });
    const app = await buildTestApp(service);

    const response = await app.inject({ method: 'GET', url: '/workitems' });

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(service.listAll)).toHaveBeenCalledOnce();
    await app.close();
  });

  it('POST /workitems calls service.create() with the parsed body', async () => {
    const item = createWorkItem('Walk the dog');
    const service = makeStubService({ create: vi.fn().mockResolvedValue(item) });
    const app = await buildTestApp(service);

    const response = await app.inject({
      method: 'POST',
      url: '/workitems',
      payload: { title: 'Walk the dog' },
    });

    expect(response.statusCode).toBe(201);
    expect(vi.mocked(service.create)).toHaveBeenCalledWith('Walk the dog');
    await app.close();
  });
});
```

> `buildTestApp()` mounts `createWorkItemsRouter({ service })` with NO prefix, unlike
> `loadApp()` which mounts it under `/api/v1` — routes here are requested at `/workitems`, not
> `/api/v1/workitems`. Prefixing is `app.register()`'s job at the mount site, not the router's
> own concern, so the router's own tests don't need to know or care what prefix production uses.
> This suite complements, not replaces, the integration tests below — it isolates router wiring
> from the rest of the app; the integration suite proves the whole request pipeline (including
> `registerErrorMapper`) end-to-end.

`createHealthRouter(checkDb)` takes its one dependency positionally (see
`reference/service-implementation.md`) — the fake is just a function, no deps object to build:

```typescript
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createHealthRouter } from '../../src/routes/health.js';

describe('createHealthRouter', () => {
  it('GET /live returns 200 without calling checkDb', async () => {
    const checkDb = async (): Promise<boolean> => {
      throw new Error('checkDb should never be called for /live');
    };
    const app = Fastify();
    await app.register(createHealthRouter(checkDb));

    const response = await app.inject({ method: 'GET', url: '/live' });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('GET /ready returns 200 when checkDb resolves true', async () => {
    const app = Fastify();
    await app.register(createHealthRouter(async () => true));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('GET /ready returns 503 when checkDb resolves false', async () => {
    const app = Fastify();
    await app.register(createHealthRouter(async () => false));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
```

> The first test's `checkDb` throws if called at all — that's the assertion. `/live` (and
> `/startup`) must never await the dependency; if a future edit accidentally makes them call
> `checkDb()`, this test fails loudly instead of just becoming slightly slower.

---

## Integration Tests — `test/integration/work-items.routes.test.ts`

```typescript
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadApp } from '../../src/app.js';
import type { IWorkItemService } from '../../src/services/work-item.service.interface.js';
import { NotFoundError, DomainValidationError } from '../../src/errors/domain.js';
import { createWorkItem, newWorkItemId } from '../../src/domain/work-item.js';
import type { WorkItem, WorkItemId } from '../../src/domain/work-item.js';

// ── Stub service factory ───────────────────────────────────────────────────────
// Tests pass a stub directly to loadApp({ service }) — no vi.mock() needed.
// Each test configures exactly the behavior it needs via mockResolvedValue/mockRejectedValue.
function makeStubService(overrides: Partial<IWorkItemService> = {}): IWorkItemService {
  return {
    listAll: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockRejectedValue(new NotFoundError('WorkItem', 'stub')),
    create: vi.fn().mockRejectedValue(new DomainValidationError('stub')),
    delete: vi.fn().mockRejectedValue(new NotFoundError('WorkItem', 'stub')),
    ...overrides,
  };
}

// ── POST /api/v1/workitems ────────────────────────────────────────────────────
describe('POST /api/v1/workitems', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const item = createWorkItem('Buy milk');
    app = await loadApp({
      service: makeStubService({ create: vi.fn().mockResolvedValue(item) }),
    });
  });

  afterAll(() => app.close());

  it('201 with created work item for valid title', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workitems',
      payload: { title: 'Buy milk' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<WorkItem>();
    expect(body.title).toBe('Buy milk');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('400 for empty title (Zod rejects before service is called)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workitems',
      payload: { title: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400 when title field is missing (Zod rejects before service is called)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workitems',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

// ── GET /api/v1/workitems/:id ─────────────────────────────────────────────────
describe('GET /api/v1/workitems/:id', () => {
  let app: FastifyInstance;
  const existingItem: WorkItem = { id: newWorkItemId(), title: 'Walk the dog', createdAt: new Date() };
  const missingId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    app = await loadApp({
      service: makeStubService({
        getById: vi.fn()
          // Type the id param explicitly — vi.fn() callbacks are untyped (any) by default,
          // which triggers no-unsafe-assignment. Promise.resolve/reject not async — require-await.
          .mockImplementation((id: WorkItemId) =>
            id === existingItem.id
              ? Promise.resolve(existingItem)
              : Promise.reject(new NotFoundError('WorkItem', id)),
          ),
      }),
    });
  });

  afterAll(() => app.close());

  it('200 with work item when found', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/workitems/${existingItem.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<WorkItem>().title).toBe('Walk the dog');
  });

  it('404 for unknown ID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/workitems/${missingId}`,
    });

    expect(response.statusCode).toBe(404);
  });
});

// ── DELETE /api/v1/workitems/:id ──────────────────────────────────────────────
describe('DELETE /api/v1/workitems/:id', () => {
  let app: FastifyInstance;
  const existingId = newWorkItemId();
  const missingId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    app = await loadApp({
      service: makeStubService({
        delete: vi.fn()
          .mockImplementation((id: WorkItemId) =>
            id === existingId
              ? Promise.resolve()
              : Promise.reject(new NotFoundError('WorkItem', id)),
          ),
      }),
    });
  });

  afterAll(() => app.close());

  it('204 when work item is deleted', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workitems/${existingId}`,
    });

    expect(response.statusCode).toBe(204);
  });

  it('404 when work item does not exist', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workitems/${missingId}`,
    });

    expect(response.statusCode).toBe(404);
  });
});
```

> `app.inject()` fires requests through the full Fastify pipeline (validation,
> serialization, `registerErrorMapper`) without binding a real TCP port.
> `loadApp({ service })` injects the stub via the `AppDeps` interface — no `vi.mock()`
> or module graph hacking, and no database: `loadApp()` never calls `initDb()` (see
> `reference/service-config.md`, `src/app.ts`). Tests are coupled to `IWorkItemService`,
> not to the concrete `DrizzleWorkItemRepository` or the `db` module.
> Service stubs reject with the actual `ExtendableError` subclass the real service would
> throw (`NotFoundError`, `DomainValidationError`) — `registerErrorMapper` maps the thrown
> class to a status exactly as it would in production, so these tests exercise the real
> mapping, not a re-implementation of it.
> The two "400" `POST` tests never actually reach the mocked `create` — `CreateWorkItemSchema`
> (`z.string().min(1)`) rejects the request at Fastify's schema-validation layer first. The
> stub's `create` override only fires for the valid-title case, which is why it's a plain
> `mockResolvedValue` rather than a multi-call chain.
