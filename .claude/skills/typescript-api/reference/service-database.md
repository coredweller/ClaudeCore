# TypeScript REST API — Database Reference (pg + Drizzle)

## Driver and Lifecycle

| Decision | Choice | Reason |
|----------|--------|--------|
| Driver | `pg` (node-postgres) | Native `Pool` with lifecycle callbacks; `drizzle-orm/node-postgres` is its first-class adapter |
| Connection management | `initDb()` / `getDb()` / `closeDb()` | `getDb()` throws if uninitialized — crashes loudly rather than silently queuing against a dead pool |
| Transaction ownership | Service layer | Repositories accept `DbClient = DB \| TX`; the service decides whether to wrap in a transaction |

## Package Changes

Replace `postgres` with `pg`:

```json
// package.json — dependencies (add/replace)
"pg": "^8.13.0",
"drizzle-orm": "^0.44.0"

// package.json — devDependencies (add)
"@types/pg": "^8.11.0"
```

Remove `"postgres": "^3.4.5"` — it is superseded entirely by `pg`.

---

## src/db.ts

```typescript
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { config } from './config.js';
import { logger } from './logger.js';
import * as schema from './schema/index.js';

let _pool: Pool | null = null;
let _db: Db | null = null;

export type Db = ReturnType<typeof drizzle<typeof schema>>;
// Extracts the transaction type from db.transaction() callback parameter.
// Repositories accept TX so the service layer can span multiple repos in one transaction.
export type TX = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbClient = Db | TX;

export async function initDb(): Promise<void> {
  if (_db !== null) return; // double-init guard — idempotent, safe to call more than once

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: 2_000,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
  });

  // Required. node-postgres emits 'error' on the Pool whenever an idle client in the pool
  // hits a network-level failure (the DB restarts, a connection is reset, a firewall drops
  // an idle socket). Without this listener, that's an unhandled 'error' event, which is fatal
  // in Node — the entire process crashes, taking down every in-flight request, not just the
  // one connection. With it, the failure is logged and the pool quietly replaces the dead
  // client on the next checkout.
  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected error on idle pg client');
  });

  // Fail-fast: verify the DB is reachable — and that credentials, TLS config, and network
  // routing are all valid — before accepting HTTP traffic. A wrong password, an unreachable
  // host, or a bad DATABASE_URL crashes the process here, at startup, instead of surfacing as
  // a 500 on whichever request happens to be the first one that touches the database.
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    // Always release in `finally` — if the check query above throws, the client must still
    // return to the pool (or be destroyed by pg) rather than being held open forever.
    client.release();
  }

  _pool = pool;
  _db = drizzle(pool, { schema });
}

export async function closeDb(): Promise<void> {
  await _pool?.end();
  _pool = null;
  _db = null;
}

export function getDb(): Db {
  if (_db === null) {
    throw new Error('Database not initialized — call initDb() before getDb()');
  }
  return _db;
}

// Used by the readiness probe only (see reference/service-implementation.md,
// "Health Router") — never throws, converts any failure (including "not initialized
// yet") into `false` so /ready can return 503 instead of crashing. The caller logs
// the failure; this function stays silent by design, matching the sanctioned
// safeParse-style boundary exception in code-standards.md's error-handling rule.
export async function checkDb(): Promise<boolean> {
  try {
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
```

---

## Accessor, Not Export

`_pool` and `_db` are `let` bindings private to `db.ts` — neither is ever exported, not even
as a `readonly` reference, and not even temporarily for a one-off script or debug endpoint.
The only exported surface is the three functions: `initDb()`, `getDb()`, `closeDb()`.

**Route handlers, services, and repositories call `getDb()` — they never `import { _db }`.**
There is nothing to import; the underlying variable has no external name. This is what makes
the "throws if uninitialized" contract from `code-standards.md`'s Resource Lifecycle table
actually enforceable: if `_db` itself were exported, any caller could read it directly, get
`null` before `initDb()` has run, and hit a confusing `Cannot read properties of null` deep
inside a Drizzle call instead of `getDb()`'s explicit, named error. An accessor function is
also the only way `closeDb()` can safely reset state — every caller re-fetches via `getDb()`
rather than holding a stale reference from before a close/reinit cycle (relevant in tests,
where `closeDb()` → `initDb()` may run repeatedly against a test database).

```typescript
// ❌ Forbidden — exporting the mutable binding directly
export let _db: Db | null = null;

// ❌ Forbidden — a repository or route holding its own reference instead of calling getDb()
import { _db } from '../db.js';
async findById(id: WorkItemId) {
  return _db.select()...  // stale if closeDb()/initDb() ran again; no uninitialized guard
}

// ✅ Required — every call site fetches through the accessor
import { getDb } from '../db.js';
async findById(id: WorkItemId, db: DbClient) {
  return db.select()...  // db passed in by the service, itself sourced from getDb()
}
```

---

## Schema-as-Code Conventions

```typescript
// src/schema/work-items.schema.ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Column names always explicit (TS camelCase → DB snake_case)
export const workItems = pgTable('work_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Always infer row types — never write them by hand
export type WorkItemRow = typeof workItems.$inferSelect;
export type NewWorkItemRow = typeof workItems.$inferInsert;
```

Rules:
- Always pass `{ withTimezone: true }` to every `timestamp()` column — stores UTC, eliminates timezone bugs
- **`uuid('id').primaryKey().defaultRandom()` over auto-increment integers.** A `serial`/
  `bigserial` primary key leaks the row count and insertion order to anyone who can see an ID
  (enumerable in a public API — `/workitems/1043` implies ~1043 rows exist), and it forces a
  round trip to the database to learn the ID of a row before it's inserted. `defaultRandom()`
  generates the UUID (`gen_random_uuid()`) in Postgres at insert time — same DB-side guarantee
  of uniqueness — but the value carries no sequence information and never collides across
  shards, replicas, or a restored-from-backup table where a sequence counter could otherwise
  repeat.
- Define indexes and constraints in `pgTable`'s third argument, not in migration SQL by hand
- One schema file per aggregate root — `src/schema/` is a flat directory
- Never expose `WorkItemRow` outside the repository boundary — return domain objects

---

## Startup Sequence

**Non-negotiable rule: `initDb()` is called in `server.ts` AFTER `loadApp()` — never inside `loadApp()`.**

**Why:** every integration test calls `loadApp()` to get a Fastify instance for `app.inject()`. If `loadApp()` called `initDb()`, every test would need either a live database or a module-level mock of `db.ts`. Keeping DB init outside the factory means tests get a fully-wired HTTP server with no database wiring at all.

```typescript
// src/server.ts — entry point only (not imported by tests)
import { loadApp } from './app.js';
import { initDb, closeDb } from './db.js';
import { config } from './config.js';

const server = await loadApp();    // 1. Build app — no DB access
await initDb();                    // 2. Connect + verify pool
await server.listen({ port: config.PORT, host: '0.0.0.0' });  // 3. Accept requests

// Full SIGTERM/SIGINT handler with force-exit timer, closeIdleConnections(),
// and K8s termination notes: see reference/service-lifecycle.md
```

```typescript
// src/app.ts — factory consumed by server.ts and by test files
export async function loadApp(deps: AppDeps = {}) {
  // No initDb() call — DB is wired by the caller after this function returns
  const app = Fastify({ ... });
  // register plugins, routes, error handler
  return app;
}
```

Integration test setup (no DB needed):

```typescript
// test/integration/work-items.routes.test.ts
const app = await loadApp({ service: mockService }); // No DB — loadApp() has no DB dependency
await app.ready();
const res = await app.inject({ method: 'GET', url: '/api/v1/workitems' });
```

---

## Repository Signatures — DbClient Pattern

**Non-negotiable rule: repository functions accept `db: DbClient` as their first parameter and never call `getDb()` themselves.**

**Why:** `getDb()` inside a repository bypasses the service's transaction boundary. If a service wraps two repository calls in `db.transaction(tx => ...)` but a repository calls `getDb()` internally, that call executes outside the transaction — the two writes can split across a failure with no rollback. Enforcing `DbClient` as a parameter makes the transaction boundary visible in every call site.

The full `DrizzleWorkItemRepository` implementing this pattern, and the `WorkItemService`
methods that own the simple (non-transactional) `getDb()` call, live in
`reference/service-implementation.md`. They are not duplicated here: two independently
maintained copies of the same class is exactly how this rule drifted out of sync with
`IWorkItemRepository` before (repository took no `db` param there; the service already called
it with one here). One canonical copy, referenced from both places.

The one case `service-implementation.md` doesn't show is a multi-repo write inside a single
transaction — worth keeping here since it's the reason `DbClient` (not a bare `Db`) exists:

```typescript
// src/services/work-item.service.ts — transaction-owning method
// Multi-repo write — service owns the transaction; passes `tx` to every repo call so both
// writes commit or roll back together.
async createWithAudit(title: string): Promise<WorkItem> {
  const item = createWorkItem(title);
  await getDb().transaction(async (tx) => {
    await this.repository.save(tx, item);
    await this.auditRepository.log(tx, { action: 'created', itemId: item.id });
  });
  return item;
}
```

> `tx` (not `getDb()`) is passed to both repository calls — that's what keeps them inside the
> same transaction. Passing `getDb()` to `auditRepository.log()` here would silently run the
> audit write outside the transaction the `save()` call is in.

---

## Forbidden Patterns

```typescript
// ❌ Module-level singleton — cannot close or reinitialize; breaks test isolation
export const db = drizzle(pool, { schema });

// ❌ getDb() inside a repository — bypasses service transaction boundary
async findById(id: WorkItemId): Promise<WorkItem | null> {
  const rows = await getDb().select()...  // WRONG: repo must never call getDb()
}

// ❌ initDb() inside loadApp() — forces every integration test to mock the DB module
export async function loadApp() {
  await initDb();  // WRONG: tests call loadApp() and would need a DB connection or mock
  ...
}

// ❌ Transaction started inside a repository — transaction ownership belongs to the service
async save(item: WorkItem): Promise<void> {
  await this.db.transaction(async (tx) => {  // WRONG: service owns this boundary
    await tx.insert(workItems).values({...});
  });
}

// ❌ Constructor-injected Db field used in methods — breaks TX transparency
class DrizzleWorkItemRepository {
  constructor(private readonly db: Db) {}  // WRONG: repo can't participate in service TX
  async findById(id: WorkItemId) {
    return this.db.select()...  // uses Db, not the TX the service passed
  }
}

// ❌ Exposing raw DB row types across the repository boundary
async findById(id: WorkItemId): Promise<WorkItemRow | null>  // WRONG: return domain type

// ❌ pool.connect() without a guaranteed release — leaks connections under errors
const client = await pool.connect();
await client.query('SELECT 1');  // if this throws, client is never released
client.release();
// Correct: wrap in try/finally, or use pool.query() for one-off queries

// ❌ No pool.on('error', ...) listener — an idle client's network failure becomes an
// unhandled 'error' event, which crashes the entire Node process, not just that connection
const pool = new Pool({ connectionString: config.DATABASE_URL });
// Missing: pool.on('error', (err) => logger.error({ err }, '...'));
```
