# TypeScript REST API — Domain Templates

Pure TypeScript domain layer: aggregate roots, value objects, error types, and repository/service contracts.
No framework dependencies — these files have zero Fastify, Drizzle, or Vitest imports.

## Directory Layout

```
src/
├── domain/
│   ├── work-item.ts                    # Aggregate root + branded ID + factory
│   └── errors.ts                       # AppError discriminated union + Result<T>
├── repositories/
│   ├── work-item.repository.interface.ts
│   └── work-item.repository.ts         # Drizzle implementation (see implementation reference)
├── services/
│   ├── work-item.service.interface.ts
│   └── work-item.service.ts            # (see implementation reference)
├── routes/
│   └── work-items.ts                   # Fastify route plugin (see implementation reference)
└── schema/
    └── work-items.schema.ts            # Drizzle table (see config reference)
test/
├── unit/
│   └── work-item.service.test.ts       # (see test reference)
└── integration/
    └── work-items.routes.test.ts       # (see test reference)
```

---

## Domain Model — `src/domain/work-item.ts`

```typescript
// ── Branded ID — prevents passing a raw string where WorkItemId is expected ──
export type WorkItemId = string & { readonly _brand: 'WorkItemId' };

export function newWorkItemId(): WorkItemId {
  return crypto.randomUUID() as WorkItemId;
}

export function workItemIdFrom(value: string): WorkItemId {
  return value as WorkItemId;
}

// ── Aggregate root ─────────────────────────────────────────────────────────
export interface WorkItem {
  readonly id: WorkItemId;
  readonly title: string;
  readonly createdAt: Date;
}

// Factory — only valid WorkItems can be constructed
export function createWorkItem(title: string): WorkItem {
  return {
    id: newWorkItemId(),
    title: title.trim(),
    createdAt: new Date(),
  };
}

// Reconstitute from persistence (no business rules applied)
export function reconstituteWorkItem(
  id: string,
  title: string,
  createdAt: Date,
): WorkItem {
  return { id: workItemIdFrom(id), title, createdAt };
}
```

> `WorkItemId` is a branded type — `string & { readonly _brand: 'WorkItemId' }`.
> A plain `string` cannot be passed where `WorkItemId` is expected without an explicit cast.
> Use `newWorkItemId()` for new entities and `workItemIdFrom()` at persistence boundaries only.

---

## Domain Errors — `src/domain/errors.ts`

```typescript
// ── AppError discriminated union — exhaustive, pattern-matchable ───────────
export type AppError =
  | { readonly kind: 'NotFound'; readonly id: string }
  | { readonly kind: 'ValidationError'; readonly message: string }
  | { readonly kind: 'Conflict'; readonly message: string };

// ── Result<T> — makes error states explicit in function signatures ──────────
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

> `Result<T>` replaces exceptions for domain errors. Services return `Promise<Result<T>>` —
> callers handle both outcomes explicitly. HTTP status mapping lives in the route plugin,
> not here — the domain has no knowledge of HTTP.

---

## Repository Interface — `src/repositories/work-item.repository.interface.ts`

```typescript
import type { WorkItem, WorkItemId } from '../domain/work-item.js';

export interface IWorkItemRepository {
  findAll(): Promise<readonly WorkItem[]>;
  findById(id: WorkItemId): Promise<WorkItem | null>;
  save(item: WorkItem): Promise<WorkItem>;
  deleteById(id: WorkItemId): Promise<boolean>;
}
```

> The interface depends only on domain types — no Drizzle imports, no `db` type.
> This keeps the domain layer framework-agnostic and allows the Drizzle implementation
> to be swapped (e.g. for an in-memory stub in tests) without touching any service code.

---

## Service Interface — `src/services/work-item.service.interface.ts`

```typescript
import type { WorkItem, WorkItemId } from '../domain/work-item.js';
import type { Result } from '../domain/errors.js';

export interface IWorkItemService {
  listAll(): Promise<readonly WorkItem[]>;
  getById(id: WorkItemId): Promise<Result<WorkItem>>;
  create(title: string): Promise<Result<WorkItem>>;
  delete(id: WorkItemId): Promise<Result<true>>;
}
```

> `listAll()` returns `readonly WorkItem[]` directly — it never fails in a domain sense
> (an empty list is a valid result). Methods that can fail return `Promise<Result<T>>`.
> Route handlers depend on `IWorkItemService`, not the concrete `WorkItemService` —
> this enables stub injection via `buildApp({ service })` in integration tests.
