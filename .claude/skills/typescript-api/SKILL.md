---
name: typescript-api
description: Skill for Node.js TypeScript REST API development with Fastify v5, Zod validation, Drizzle ORM, and Vitest. Activate when creating routes, services, repositories, domain models, or tests in TypeScript.
allowed-tools: Bash, Read, Glob, Grep
---

# TypeScript REST API Skill (Fastify + Zod + Drizzle + Vitest)

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Framework | Fastify v5 | Type-safe, schema-driven, fastest Node HTTP framework; first-class TypeScript support |
| Validation | Zod + `@fastify/type-provider-zod` | Runtime validation with inferred static types — one schema, zero duplication |
| ORM | Drizzle ORM | Fully typed SQL, no magic, no N+1, explicit queries |
| DB driver | `pg` (node-postgres) + `Pool` | Explicit pool lifecycle; `initDb()` fail-fast before HTTP starts; `getDb()` throws if uninitialized |
| Error handling | Error envelope `{ success, message, reason_code }` + `typedErrorMapper` | One envelope shape for all errors including 500; class→status in one place; ad-hoc inline 4xx is the named anti-pattern |
| Logging | Pino (built into Fastify) | Structured JSON logs, minimal overhead; `request.log` per-request |
| Testing | Vitest + `app.inject()` | ESM-native, fast, uses Fastify's built-in HTTP injection — no real port needed |
| TypeScript | Strict mode + `noUncheckedIndexedAccess` | Maximum type safety; branded types for domain IDs |
| Module system | ESM (`"type": "module"`) | Modern, tree-shakeable; Node 24 LTS native |
| Config | Zod `z.parse(process.env)` at startup | Fails fast on missing env vars before any request is served |

## Process

`code-standards.md` is auto-loaded from rules — it is the only file read unconditionally. For reference files, consult the table below and load only what your specific task requires.

1. Identify which reference files apply to your task (see Reference Files table below)
2. Hard-to-reverse infrastructure choice on the table (ORM, message broker, cache, auth flow)? Write an ADR before implementing it — see the `architecture-decision-records` skill for the template
3. Define Zod schemas **first** — they derive both runtime validation and static types
4. Register `setNotFoundHandler` then `registerErrorMapper(app)` in `loadApp()` before routes
5. Throw custom error classes from handlers; never construct inline error responses
6. Run `npm run typecheck && npm test` before finishing


## Startup Sequence

`server.ts` is the only entry point. `app.ts` exports `loadApp()` — the factory consumed by both `server.ts` and integration tests.

```
server.ts
  1. const server = await loadApp()          ← registers plugins + routes; zero resource access
  2. await initDb()                          ← pool created, TLS configured, pool.connect() verified
  3. await server.listen(...)                ← starts accepting HTTP traffic
  4. SIGTERM/SIGINT →
       server.server.closeIdleConnections()  ← drain keep-alive sockets immediately
       await server.close()                  ← wait for in-flight requests
       await closeDb()                       ← release pool (reverse init order)
       process.exit(0)
     [10 s force-exit timer, unref'd, fires exit(1) if teardown stalls]
```

**Why this order matters:** integration tests call `loadApp()` with stub services and never touch the database. If `initDb()` were inside `loadApp()`, every test would require a live DB connection or a module-level mock.

Full signal handler with `closeIdleConnections()`, force-exit timer, multi-resource teardown order, and K8s `terminationGracePeriodSeconds` guidance: `reference/service-lifecycle.md`.

## Common Commands

```bash
npm run dev          # Start dev server with tsx --watch (port 3000)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output (dist/server.js)
npm test             # Run Vitest test suite
npm run typecheck    # tsc --noEmit (type-check without emitting)
npm run lint         # ESLint with @typescript-eslint
npm run format       # Prettier --write
npm run format:check # Prettier --check (CI)
npm run db:generate  # drizzle-kit generate (create migration files)
npm run db:migrate   # drizzle-kit migrate (apply migrations to DB)
npm run db:studio    # Drizzle Studio (visual DB browser)
```

## Key Patterns

| Pattern | Implementation |
|---------|----------------|
| Domain IDs | Branded type: `type WorkItemId = string & { readonly _brand: 'WorkItemId' }` |
| Validation (automatic) | Zod schema in `validation-schema/<feature>.schema.ts` (`*Schema` naming) → `z.infer<typeof Schema>`; Fastify's type provider validates `{ schema: { body, params, ... } }` automatically. Distinct from `schema/<feature>.schema.ts` (Drizzle table definitions, DB layer, not HTTP) |
| Validation (manual, auto isn't enough) | Shape A `validation/<feature>-request.ts` — parses `unknown`, returns typed DTO, throws `DomainValidationError` — OR — Shape B `validation-schema/<feature>.schema.ts` + `.safeParse()` + `sendValidationError()`. Either way, raw Zod never appears in the handler body |
| Result type | `type Result<T, E = ExtendableError> = \| { ok: true; value: T } \| { ok: false; error: E }` — internal use only |
| Service return | Throw custom error class on failure; return value directly on success |
| Router | `createFooRouter(deps: FooDeps): FastifyPluginCallbackZod` — deps object injected (not imported), mounted via `app.register(createFooRouter(deps), { prefix })`; a router with exactly one dependency (e.g. `createHealthRouter(checkDb)`) takes it positionally instead of wrapping a one-field deps object |
| Health probes + root | `createHealthRouter(checkDb)` mounted unprefixed, outside `/api/v1` — `/`, `/live`, and `/startup` return `{ status, version }` immediately with no dependency check; `/ready` awaits `checkDb()`, returns 503 (not an `ErrorEnvelope`) if unreachable |
| Route handler | `throw new XError(...)` on failure; `return value` on success — **never** `reply.status(4xx).send(...)` |
| Error envelope | `{ success: false, message: string, reason_code: number }` — all errors, every status code |
| typedErrorMapper | `app.setErrorHandler(...)` in `loadApp()` — sole place for class→status mapping; no `instanceof` in routes |
| Validation extension | `validation_errors: ZodIssue[]` — the **one** sanctioned field added to `ErrorEnvelope` |
| Repository | Interface + Drizzle implementation; methods accept `db: DbClient` as first param — never call `getDb()` internally |
| DB lifecycle | `initDb()` in `server.ts` after `loadApp()`; `getDb()` throws if called before init; `closeDb()` on SIGTERM |
| Transaction ownership | Service calls `getDb().transaction(tx => ...)`; passes `tx` to every repository method in the boundary |
| DbClient type | `type DbClient = Db \| TX` — extracted from `Parameters<Parameters<Db['transaction']>[0]>[0]`; enables transparent TX participation |
| Config | `z.object({...}).parse(process.env)` — validated at startup, exported as typed `config`; every key backed by a real env var, every credential field `sensitive: true` in `fieldMeta`, redacted via `getProperties()` — never log or serialize `config` directly |
| Logging | `request.log.info({ workItemId }, 'message')` — structured, never string interpolation. Additive: routes accumulate a `logFields` object through the handler and emit one `request.log?.info(logFields, 'operation completed')` at the end of the success path — this doesn't replace the service's own `debug`/`warn`/`info` calls |
| Error handler | `registerErrorMapper(app)` wires `setErrorHandler`; maps each `ExtendableError` subclass to its status code |

## Reference Files

| File | Read when... |
|------|-------------|
| `reference/service-config.md` | Scaffolding a new service; editing `package.json`, `tsconfig.json`, Dockerfile, or env schema |
| `reference/service-app.md` | Editing `src/app.ts` (`loadApp()`), Fastify plugin/middleware/hook wiring order, or logger config |
| `reference/service-database.md` | Writing repositories, DB-backed service methods, schema definitions, or database config |
| `reference/service-lifecycle.md` | Editing the `server.ts` entry point; adding or removing a resource with an init/close lifecycle |
| `reference/service-errors.md` | Writing route handlers, error classes, `typedErrorMapper`, or any code that throws or catches |
| `reference/service-domain.md` | Defining or changing domain models, branded IDs, repository interfaces, or service interfaces |
| `reference/service-implementation.md` | Writing or modifying a Drizzle repository, service class, a `createFooRouter` router, or the health router |
| `reference/service-tests.md` | Writing or modifying tests |

### Optional Reference Files

Only load these when the service actually needs that capability.

| File | Load when... | Key additions |
|------|--------------|---------------|
| `reference/service-clients.md` | Service proxies or composes an upstream HTTP API | Typed error taxonomy (`GatewayError`/`NetworkError`/`UpstreamClientError`/`CredentialError`), `request<T>()` with AbortController timeout, per-operation lazy circuit breakers (`opossum`), `classifyUpstreamError()` (not `handleXError()` — see `service-errors.md`'s distinct function of that name), `typedErrorMapper` extensions for 502/4xx passthrough |
| `reference/service-observability.md` | Service emits application metrics to Datadog | `hot-shots` DogStatsD singleton (`initMetrics/getMetrics/closeMetrics`), bounded-cardinality tag rules, timing pattern on every path including failures, throttled `errorHandler`, import-time config caveat |

## Optional Stack Choices

Load the corresponding reference file before generating any code that uses these.

| Capability | Package | Decision |
|------------|---------|----------|
| HTTP client timeouts | Built-in `fetch` + `AbortController` | No extra package; timer cleared in `finally`; timeout throws `NetworkError` caught upstream |
| Circuit breaker | `opossum` | Per-operation breakers so one slow endpoint doesn't trip another; `errorFilter` excludes 4xx (expected) from failure count; lazy singleton because modules load before config validation |
| Application metrics | `hot-shots` (DogStatsD) | Lazy `initMetrics()` singleton; `errorHandler` throttled to 1 log/min; tag values must be bounded enums — never IDs, URLs, or user input |

## Error Routing

Every error surface in a route handler has exactly one correct action. No exceptions.

| Situation | Action | Who handles status + envelope |
|-----------|--------|-------------------------------|
| Service / repo signals domain error | `throw new XError(...)` | `typedErrorMapper` |
| Manual validation (Shape A) | Parser throws `DomainValidationError` | `typedErrorMapper` |
| Manual validation (Shape B) | `return sendValidationError(reply, parsed.error.issues)` | helper enforces envelope directly |
| External / upstream call fails | `handleXError(err)` — throws `UpstreamError` | `typedErrorMapper` → 500 envelope |
| Happy path | `return value` or `return reply.status(201).send(value)` | — |

**Anti-pattern:** any `reply.status(4xx).send({...})` written directly in a route handler. If you are about to write one, stop and use the table above.

## Documentation Sources

Before generating code, verify against current docs:

| Source | Tool | What to check |
|--------|------|---------------|
| Fastify | Context7 MCP (`fastify/fastify`) | Route declaration, plugin API, lifecycle hooks, `setErrorHandler`, type providers |
| Zod | Context7 MCP (`colinhacks/zod`) | Schema types, `safeParse`, transforms, refinements, `z.infer` |
| Drizzle ORM | Context7 MCP (`drizzle-team/drizzle-orm`) | `pgTable`, `db.select()`, `db.insert()`, `db.delete()`, `eq`, migrations |
| Vitest | Context7 MCP (`vitest-dev/vitest`) | `describe`, `it`, `expect`, `vi.fn()`, `beforeEach`, coverage |
| TypeScript | Context7 MCP (`microsoft/TypeScript`) | Branded types, `satisfies`, `const` assertions, `noUncheckedIndexedAccess` |

## Error Handling

- **All errors** return `{ success: false, message, reason_code }` — same envelope at every status code including 500
- **Domain errors**: throw a custom `ExtendableError` subclass from the handler (or service) — `typedErrorMapper` maps class → status
- **Validation failures** (automatic Fastify/Zod validation isn't enough): Shape A — a `validation/<feature>-request.ts` parser throws `DomainValidationError`, same as any other domain error; OR Shape B — explicit `safeParse()` + `return sendValidationError(reply, issues)`, which adds `validation_errors: ZodIssue[]` to the envelope
- **Upstream failures**: `throw new UpstreamError(name, cause)` — `typedErrorMapper` returns 500 envelope; never swallow upstream errors
- **Never** catch and swallow: every `catch` must log and rethrow or throw a typed error
- **Never** write `reply.status(4xx).send({...})` in a route handler — that is the named anti-pattern; use the Error Routing table above
