# TypeScript REST API — Test Templates

Three layers: service unit tests (no I/O), router unit tests (HTTP wiring only), and
integration tests (full pipeline via `app.inject()`).

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

// WorkItemService calls getDb() directly, so mock the module — unit tests never need a real
// pool. vi.mock() is hoisted above imports, so declaration order doesn't matter. Importing
// getDb here resolves to the SAME mocked function, which is what lets beforeEach re-arm it.
vi.mock('../../src/db.js', () => ({ getDb: vi.fn() }));

// restoreMocks: true (vitest.config.ts) resets a vi.mock()-factory vi.fn() to a no-op
// returning undefined before every test — there's no "original implementation" to restore
// to. Without this beforeEach, only the FIRST test here would get a real return value from
// getDb(); every later one would silently get undefined. The value is opaque: repository
// methods are stubbed too, so nothing inspects its shape — it only satisfies DbClient.
beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({} as DbClient);
});

// ── Stub repository ──────────────────────────────────────────────────────────
// Stubs take db: DbClient first, matching IWorkItemRepository — a stub written with the old
// zero-arg signature fails tsc rather than silently passing.
function makeRepository(overrides: Partial<IWorkItemRepository> = {}): IWorkItemRepository {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    // Promise.resolve(), not async () => — async with nothing to await trips require-await
    save: vi.fn().mockImplementation((_db: DbClient, item: WorkItem) => Promise.resolve(item)),
    deleteById: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

// Only the 4 methods the service uses need stubbing; the double assertion satisfies Pino's
// ~40-method Logger type without `as any` (banned by no-explicit-any).
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
    // vi.mocked() wraps the spy with its Mock type — avoids an unbound-method lint error
    // when passing a method reference to expect()
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
    // save(db, item) — first arg is the mocked DbClient, second the item under test
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

> Service methods either resolve with a value or reject with an `ExtendableError` subclass —
> assert with `.resolves.toEqual(...)` / `.rejects.toThrow(...)`, never `result.ok` (the service
> never returns `Result<T>`, so that field doesn't exist). Logging is a side effect, not a
> domain concern — stub it, don't assert on it.

---

## Router Unit Tests — `test/unit/work-items.router.test.ts`

`createWorkItemsRouter(deps)` is DI'd, so it mounts on a bare Fastify instance with fake deps —
no `loadApp()`, no `initDb()`, not even the error mapper. Narrower than the integration suite
below: this proves the router wires HTTP → service, not that the whole app boots.

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

// No registerErrorMapper — a 500 from an unmapped throw is expected and fine here; this
// suite only asserts the router calls the right service method with the right args.
// Mounted with NO prefix, unlike loadApp()'s '/api/v1': prefixing is app.register()'s job at
// the mount site, so the router's own tests don't care what prefix production uses.
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

`createHealthRouter(checkDb)` takes its one dependency positionally, so the fake is just a
function — no deps object to build:

```typescript
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createHealthRouter } from '../../src/routes/health.js';

async function buildHealthApp(checkDb: () => Promise<boolean>) {
  const app = Fastify();
  await app.register(createHealthRouter(checkDb));
  await app.ready();
  return app;
}

describe('createHealthRouter', () => {
  // The fake throws if called at all — that IS the assertion. If a future edit makes a
  // dependency-free probe await checkDb(), these fail loudly instead of just getting slower.
  it.each(['/', '/live', '/startup'])('GET %s returns 200 without calling checkDb', async (url) => {
    const app = await buildHealthApp(() => {
      throw new Error(`checkDb should never be called for ${url}`);
    });

    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it.each([
    [true, 200],
    [false, 503],
  ])('GET /ready returns %s → %i', async (ready, expected) => {
    const app = await buildHealthApp(() => Promise.resolve(ready));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(expected);
    await app.close();
  });
});
```

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

// Stubs reject with the actual ExtendableError subclass the real service would throw, so
// registerErrorMapper maps class → status exactly as in production. Each test overrides
// only the behavior it needs; no vi.mock() and no database (loadApp() never calls initDb()).
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

  // Both 400 cases are rejected by CreateWorkItemSchema at Fastify's validation layer and
  // never reach the stubbed create() — which is why the override above is a plain
  // mockResolvedValue rather than a multi-call chain.
  it.each([
    ['empty title', { title: '' }],
    ['missing title field', {}],
  ])('400 for %s (Zod rejects before the service is called)', async (_label, payload) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workitems',
      payload,
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
          // Type the id param explicitly — vi.fn() callbacks are `any` by default, which
          // trips no-unsafe-assignment. Promise.resolve/reject, not async — require-await.
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

  it.each([
    ['204 when work item is deleted', () => existingId, 204],
    ['404 when work item does not exist', () => missingId, 404],
  ])('%s', async (_label, id, expected) => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workitems/${id()}`,
    });

    expect(response.statusCode).toBe(expected);
  });
});
```

> `app.inject()` fires requests through the full Fastify pipeline (validation, serialization,
> `registerErrorMapper`) without binding a TCP port. `loadApp({ service })` injects the stub via
> the `AppDeps` interface — no module-graph hacking and no database. Tests are coupled to
> `IWorkItemService`, never to `DrizzleWorkItemRepository` or the `db` module.
