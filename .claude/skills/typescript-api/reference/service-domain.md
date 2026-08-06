# TypeScript REST API — Domain Templates

Pure TypeScript domain layer: aggregate roots, value objects, error types, and repository/service contracts.
No framework dependencies for domain **logic** — `work-item.ts` and `errors.ts` have zero
Fastify, Drizzle, or Vitest imports. The one exception is `DbClient` in the repository
interface: an opaque persistence-handle port type, not a Drizzle query-API dependency —
see the note under Repository Interface below.

Files covered here: `src/domain/work-item.ts`, `src/domain/errors.ts`,
`src/repositories/*.repository.interface.ts`, `src/services/*.service.interface.ts`. Full
project tree: `reference/service-config.md`.

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

Error propagation uses custom classes extending `ExtendableError` — never an `AppError`
discriminated union. Full hierarchy: `reference/service-errors.md`.

`Result<T>` is optional, for internal functions that prefer explicit branching over throwing:

```typescript
// ── Result<T> — optional; useful for pure functions that branch without throwing ──
import type { ExtendableError } from '../errors/ExtendableError.js';

export type Result<T, E extends ExtendableError = ExtendableError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E extends ExtendableError>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

> Services throw custom error classes directly — they do not return `Result<T>` at the
> service boundary. `Result<T>` may be used for internal helper functions where explicit
> branching is clearer than throwing. HTTP error mapping is never a domain concern.

---

## Repository Interface — `src/repositories/work-item.repository.interface.ts`

```typescript
import type { WorkItem, WorkItemId } from '../domain/work-item.js';
import type { DbClient } from '../db.js';

export interface IWorkItemRepository {
  findAll(db: DbClient): Promise<readonly WorkItem[]>;
  findById(db: DbClient, id: WorkItemId): Promise<WorkItem | null>;
  save(db: DbClient, item: WorkItem): Promise<WorkItem>;
  deleteById(db: DbClient, id: WorkItemId): Promise<boolean>;
}
```

> `DbClient` here is a persistence-handle **port**, not a dependency on Drizzle's query API —
> the interface never calls a method on it, it only threads the handle through so the service
> can decide whether a call joins a transaction (`reference/service-database.md`, "Repository
> Signatures — DbClient Pattern"). This is the one type-level exception to "no framework
> dependencies" above: without it a Drizzle-backed repository couldn't implement this interface
> at all, since transaction participation requires the caller to pass the active handle in.

---

## Service Interface — `src/services/work-item.service.interface.ts`

```typescript
import type { WorkItem, WorkItemId } from '../domain/work-item.js';

export interface IWorkItemService {
  listAll(): Promise<readonly WorkItem[]>;
  getById(id: WorkItemId): Promise<WorkItem>;     // throws NotFoundError
  create(title: string): Promise<WorkItem>;       // throws DomainValidationError
  delete(id: WorkItemId): Promise<void>;          // throws NotFoundError
}
```

> Methods that can fail throw a custom `ExtendableError` subclass — they do not return `Result<T>`.
> Callers (route handlers) let the error propagate to `typedErrorMapper`.
> Route handlers depend on `IWorkItemService`, not the concrete `WorkItemService` —
> this enables stub injection via `loadApp({ service })` in integration tests.
