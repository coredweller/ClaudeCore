# TypeScript REST API — Database Reference (pg + Drizzle)

## Driver and Lifecycle

| Decision | Choice | Reason |
|----------|--------|--------|
| Driver | `pg` (node-postgres) | Native `Pool` with lifecycle callbacks; `drizzle-orm/node-postgres` is its first-class adapter |
| Connection management | `initDb()` / `getDb()` / `closeDb()` | `getDb()` throws if uninitialized — crashes loudly rather than silently queuing against a dead pool |
| Transaction ownership | Service layer | Repositories accept `DbClient = Db \| TX`; the service decides whether to wrap in a transaction |

Packages and pinned versions live in `reference/service-config.md`'s `package.json` — `pg`,
`@types/pg`, and `drizzle-orm`. There is no `postgres` (postgres.js) dependency; the migrator
import is `drizzle-orm/node-postgres/migrator`, never `drizzle-orm/postgres-js/migrator`.

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
// Extracts the transaction type from db.transaction()'s callback parameter.
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

  // Required. node-postgres emits 'error' on the Pool whenever an idle client hits a
  // network-level failure (DB restart, connection reset, firewall dropping an idle socket).
  // Without this listener that's an unhandled 'error' event — fatal in Node, taking down
  // every in-flight request rather than the one connection.
  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected error on idle pg client');
  });

  // Fail-fast: verify reachability, credentials, TLS config, and routing before accepting
  // HTTP traffic — a bad DATABASE_URL crashes the process here at startup instead of
  // surfacing as a 500 on whichever request first touches the database.
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    // Release in `finally` — if the check query throws, the client must still return to
    // the pool rather than being held open forever.
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

// Readiness probe only (see reference/service-implementation.md, "Health Router") — never
// throws, converts any failure (including "not initialized yet") into `false` so /ready can
// return 503 instead of crashing. The caller logs the failure; this function stays silent by
// design, matching the sanctioned safeParse-style boundary exception in code-standards.md.
export async function checkDb(): Promise<boolean> {
  try {
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
```

> The four env vars `initDb()` reads — `DATABASE_URL`, `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`,
> `DATABASE_SSL` — are defined in the canonical env schema in `reference/service-config.md`.
> `DATABASE_SSL=true` means `{ rejectUnauthorized: true }`, a real certificate check: fix a bad
> cert or CA bundle rather than weakening it.

---

## Accessor, Not Export

`_pool` and `_db` are `let` bindings private to `db.ts` — never exported, not even as a
`readonly` reference or temporarily for a debug endpoint. The only exported surface is
`initDb()`, `getDb()`, `closeDb()`, `checkDb()`.

This is what makes the "throws if uninitialized" contract from `code-standards.md`'s Resource
Lifecycle table enforceable: an exported `_db` lets a caller read it directly, get `null`
before `initDb()` ran, and hit `Cannot read properties of null` deep inside a Drizzle call
instead of `getDb()`'s named error. An accessor is also the only way `closeDb()` can safely
reset state — every caller re-fetches rather than holding a reference from before a
close/reinit cycle (which tests do repeatedly against a test database).

```typescript
// ❌ Forbidden — exporting the mutable binding directly
export let _db: Db | null = null;

// ❌ Forbidden — a repository holding its own reference instead of receiving one
import { _db } from '../db.js';
async findById(id: WorkItemId) {
  return _db.select()...  // stale after closeDb()/initDb(); no uninitialized guard
}

// ✅ Required — the service fetches through the accessor and passes the handle down
async findById(db: DbClient, id: WorkItemId) {
  return db.select()...
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
- **`uuid().primaryKey().defaultRandom()` over auto-increment.** A `serial` PK leaks row count
  and insertion order to anyone who sees an ID (`/workitems/1043` implies ~1043 rows) and forces
  a round trip to learn a row's ID before insert. `defaultRandom()` still generates DB-side
  (`gen_random_uuid()`), but carries no sequence information and never collides across shards,
  replicas, or a restored-from-backup table whose sequence counter repeats
- Define indexes and constraints in `pgTable`'s third argument, not in hand-written migration SQL
- One schema file per aggregate root — `src/schema/` is a flat directory
- Never expose `WorkItemRow` outside the repository boundary — return domain objects

---

## Layering — Where DB Code May Live

The generic contract is in `code-standards.md` ("Service vs. Repository Layering"). Its
TypeScript/Drizzle instantiation:

- **`*.repository.ts` files are the only place `drizzle-orm`, the `schema/` module, or query
  helpers (`eq`, `sql`, ...) may be imported.** A non-repo file importing any of them is a
  layering violation — move the query into the repository and expose a typed function.
- **Services call repository methods only.** A service never builds a query, but it *does* own
  the connection handle: it calls `getDb()` (or `getDb().transaction(...)`) and passes the
  result into every repository call. That handle is the sole DB-adjacent thing a service touches.
- **If a service needs something the repository doesn't expose, add a repository method** —
  don't reach around it with an inline query.

---

## Startup Sequence

**Non-negotiable rule: `initDb()` is called in `server.ts` AFTER `loadApp()` — never inside `loadApp()`.**

**Why:** every integration test calls `loadApp()` to get a Fastify instance for `app.inject()`.
If `loadApp()` called `initDb()`, every test would need either a live database or a
module-level mock of `db.ts`. Keeping DB init outside the factory means tests get a fully-wired
HTTP server with no database wiring at all:

```typescript
// test/integration/work-items.routes.test.ts — no DB needed
const app = await loadApp({ service: mockService });
await app.ready();
const res = await app.inject({ method: 'GET', url: '/api/v1/workitems' });
```

Migrations run in `server.ts` too — after `initDb()` (they need a live pool), before
`listen()` (never serve traffic against an unmigrated schema). Full entry-point code:
`reference/service-lifecycle.md`.

---

## Repository Signatures — DbClient Pattern

**Non-negotiable rule: repository methods accept `db: DbClient` as their first parameter and never call `getDb()` themselves.**

**Why:** `getDb()` inside a repository bypasses the service's transaction boundary. If a service
wraps two repository calls in `db.transaction(tx => ...)` but a repository calls `getDb()`
internally, that call executes outside the transaction — the two writes can split across a
failure with no rollback. Passing `DbClient` makes the transaction boundary visible at every
call site.

The canonical `DrizzleWorkItemRepository` and the `WorkItemService` methods that own the simple
(non-transactional) `getDb()` call live in `reference/service-implementation.md` — not copied
here. The one case that file doesn't show is a multi-repo write in a single transaction, which
is the whole reason `DbClient` exists rather than a bare `Db`:

```typescript
// src/services/work-item.service.ts — service owns the transaction; passes `tx` to every
// repo call so both writes commit or roll back together.
async createWithAudit(title: string): Promise<WorkItem> {
  const item = createWorkItem(title);
  await getDb().transaction(async (tx) => {
    await this.repository.save(tx, item);
    await this.auditRepository.log(tx, { action: 'created', itemId: item.id });
  });
  return item;
}
```

> Passing `getDb()` to `auditRepository.log()` here instead of `tx` would silently run the audit
> write outside the transaction the `save()` call is in.

---

## Forbidden Patterns

```typescript
// ❌ Module-level singleton — cannot close or reinitialize; breaks test isolation
export const db = drizzle(pool, { schema });

// ❌ getDb() inside a repository — bypasses the service transaction boundary
async findById(id: WorkItemId): Promise<WorkItem | null> {
  const rows = await getDb().select()...
}

// ❌ Constructor-injected Db field — repo can't participate in the service's TX
class DrizzleWorkItemRepository {
  constructor(private readonly db: Db) {}
}

// ❌ Transaction started inside a repository — that boundary belongs to the service
async save(item: WorkItem): Promise<void> {
  await this.db.transaction(async (tx) => { ... });
}

// ❌ initDb() inside loadApp() — forces every integration test to mock the DB module
export async function loadApp() {
  await initDb();
  ...
}

// ❌ Exposing raw DB row types across the repository boundary
async findById(id: WorkItemId): Promise<WorkItemRow | null>  // return the domain type

// ❌ pool.connect() without a guaranteed release — leaks connections under errors
const client = await pool.connect();
await client.query('SELECT 1');  // if this throws, client is never released
client.release();
// Correct: try/finally, or pool.query() for one-off queries

// ❌ No pool.on('error', ...) listener — an idle client's network failure becomes an
// unhandled 'error' event, crashing the entire Node process
const pool = new Pool({ connectionString: config.DATABASE_URL });
```
