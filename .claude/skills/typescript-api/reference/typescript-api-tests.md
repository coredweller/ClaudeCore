# TypeScript REST API — Test Templates

Unit tests (service logic, no I/O) and integration tests (full HTTP pipeline via `app.inject()`).

---

## Unit Tests — `test/unit/work-item.service.test.ts`

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkItem } from '../../src/domain/work-item.js';
import { newWorkItemId, workItemIdFrom } from '../../src/domain/work-item.js';
import type { IWorkItemRepository } from '../../src/repositories/work-item.repository.interface.js';
import { WorkItemService } from '../../src/services/work-item.service.js';

// ── Stub repository ──────────────────────────────────────────────────────────
function makeRepository(overrides: Partial<IWorkItemRepository> = {}): IWorkItemRepository {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation(async (item: WorkItem) => item),
    deleteById: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

const noopLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

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
    expect(repository.findAll).toHaveBeenCalledOnce();
  });
});

// ── getById ──────────────────────────────────────────────────────────────────
describe('WorkItemService.getById', () => {
  it('returns ok with item when found', async () => {
    const item: WorkItem = { id: newWorkItemId(), title: 'Buy milk', createdAt: new Date() };
    const repository = makeRepository({ findById: vi.fn().mockResolvedValue(item) });
    const sut = new WorkItemService(repository, noopLog);

    const result = await sut.getById(item.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(item);
  });

  it('returns NotFound error when item does not exist', async () => {
    const repository = makeRepository({ findById: vi.fn().mockResolvedValue(null) });
    const sut = new WorkItemService(repository, noopLog);

    const result = await sut.getById(workItemIdFrom('00000000-0000-0000-0000-000000000001'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('NotFound');
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Walk the dog');
      expect(result.value.id).toBeDefined();
    }
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Walk the dog' }),
    );
  });

  it.each(['', '   '])('returns ValidationError for blank title "%s"', async (title) => {
    const result = await sut.create(title);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('ValidationError');
    expect(repository.save).not.toHaveBeenCalled();
  });
});

// ── delete ───────────────────────────────────────────────────────────────────
describe('WorkItemService.delete', () => {
  it('returns ok(true) when item is deleted', async () => {
    const id = newWorkItemId();
    const repository = makeRepository({ deleteById: vi.fn().mockResolvedValue(true) });
    const sut = new WorkItemService(repository, noopLog);

    const result = await sut.delete(id);

    expect(result.ok).toBe(true);
  });

  it('returns NotFound error when item does not exist', async () => {
    const repository = makeRepository({ deleteById: vi.fn().mockResolvedValue(false) });
    const sut = new WorkItemService(repository, noopLog);

    const result = await sut.delete(newWorkItemId());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('NotFound');
  });
});
```

> `vi.fn()` stubs avoid mocking the logger — logging is a side effect, not a domain
> concern. Tests should not assert on log calls unless verifying an audit/observability feature.
> `noopLog as any` is an acceptable workaround: the full Pino `Logger` type has ~40 methods;
> only the 4 used by the service matter here.

---

## Integration Tests — `test/integration/work-items.routes.test.ts`

```typescript
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/main.js';
import type { IWorkItemService } from '../../src/services/work-item.service.interface.js';
import { ok, fail } from '../../src/domain/errors.js';
import { createWorkItem, newWorkItemId } from '../../src/domain/work-item.js';
import type { WorkItem } from '../../src/domain/work-item.js';

// ── Stub service factory ───────────────────────────────────────────────────────
// Tests pass a stub directly to buildApp({ service }) — no vi.mock() needed.
// Each test configures exactly the behavior it needs via mockResolvedValue.
function makeStubService(overrides: Partial<IWorkItemService> = {}): IWorkItemService {
  return {
    listAll: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(fail({ kind: 'NotFound', id: 'stub' })),
    create: vi.fn().mockResolvedValue(fail({ kind: 'ValidationError', message: 'stub' })),
    delete: vi.fn().mockResolvedValue(fail({ kind: 'NotFound', id: 'stub' })),
    ...overrides,
  };
}

// ── POST /api/v1/workitems ────────────────────────────────────────────────────
describe('POST /api/v1/workitems', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const item = createWorkItem('Buy milk');
    app = await buildApp({
      service: makeStubService({
        create: vi.fn()
          .mockResolvedValueOnce(ok(item))                                         // valid title → 201
          .mockResolvedValue(fail({ kind: 'ValidationError', message: 'blank' })), // empty title → 400
      }),
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
    app = await buildApp({
      service: makeStubService({
        getById: vi.fn()
          .mockImplementation(async (id) =>
            id === existingItem.id
              ? ok(existingItem)
              : fail({ kind: 'NotFound', id }),
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
    app = await buildApp({
      service: makeStubService({
        delete: vi.fn()
          .mockImplementation(async (id) =>
            id === existingId
              ? ok(true as const)
              : fail({ kind: 'NotFound', id }),
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
> serialization, error handler) without binding a real TCP port.
> `buildApp({ service })` injects the stub via the `AppDeps` interface — no `vi.mock()`
> or module graph hacking. Tests are coupled to `IWorkItemService`, not to the concrete
> `DrizzleWorkItemRepository` or the `db` module.
