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
| Error handling | `Result<T, E>` discriminated union + Fastify error handler | No exception-driven flow control; explicit error propagation |
| Logging | Pino (built into Fastify) | Structured JSON logs, minimal overhead; `request.log` per-request |
| Testing | Vitest + `app.inject()` | ESM-native, fast, uses Fastify's built-in HTTP injection — no real port needed |
| TypeScript | Strict mode + `noUncheckedIndexedAccess` | Maximum type safety; branded types for domain IDs |
| Module system | ESM (`"type": "module"`) | Modern, tree-shakeable; Node 24 LTS native |
| Config | Zod `z.parse(process.env)` at startup | Fails fast on missing env vars before any request is served |

## Process

1. Read `reference/typescript-api-config.md` — exact `package.json`, `tsconfig.json`, `src/main.ts`, `.env.example`, `Dockerfile`
2. Read `reference/typescript-api-domain.md` — domain model, errors, repository interface, service interface
3. Read `reference/typescript-api-implementation.md` — Drizzle repository, service, route plugin
4. Read `reference/typescript-api-tests.md` — unit tests, integration tests
5. Define Zod schemas **first** — they derive both runtime validation and static types
6. Register plugins and routes in `main.ts` before implementing business logic
7. Return `Result<T, AppError>` from services; map to HTTP responses in route handlers only — never throw for domain errors
8. Run `npm run typecheck && npm test` before finishing


## Common Commands

```bash
npm run dev          # Start dev server with tsx --watch (port 3000)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output (dist/main.js)
npm test             # Run Vitest test suite
npm run typecheck    # tsc --noEmit (type-check without emitting)
npm run lint         # ESLint with @typescript-eslint
npm run db:generate  # drizzle-kit generate (create migration files)
npm run db:migrate   # drizzle-kit migrate (apply migrations to DB)
npm run db:studio    # Drizzle Studio (visual DB browser)
```

## Key Patterns

| Pattern | Implementation |
|---------|----------------|
| Domain IDs | Branded type: `type WorkItemId = string & { readonly _brand: 'WorkItemId' }` |
| Validation | Zod schema → `z.infer<typeof Schema>` for static type; `schema.safeParse()` at boundaries |
| Result type | `type Result<T, E = AppError> = \| { ok: true; value: T } \| { ok: false; error: E }` |
| Service return | `Promise<Result<T>>` — never throws for domain errors |
| Route mapping | `if (!result.ok)` → HTTP error response; `result.value` → success response |
| Repository | Interface + Drizzle implementation, returns `Promise<T \| null>` |
| Config | `z.object({...}).parse(process.env)` — validated at startup, exported as typed `config` |
| Logging | `request.log.info({ workItemId }, 'message')` — structured, never string interpolation |
| Error handler | Fastify `setErrorHandler` maps `AppError` to RFC 7807 `application/problem+json` |

## Reference Files

| File | Content |
|------|---------|
| `reference/typescript-api-config.md` | `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `src/main.ts`, `.env.example`, `Dockerfile`, `docker-compose.yml` |
| `reference/typescript-api-domain.md` | Domain model, domain errors, repository interface, service interface |
| `reference/typescript-api-implementation.md` | Drizzle repository, service implementation, route plugin |
| `reference/typescript-api-tests.md` | Unit tests (service), integration tests (routes via `app.inject()`) |

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

- **Domain errors** (not found, validation): Return `{ ok: false, error }` from service — route handler maps to 4xx RFC 7807 body
- **Unexpected exceptions**: Let them propagate to Fastify `setErrorHandler` → 500 ProblemDetails
- **Validation failures**: Zod `.safeParse()` at route boundary → 400 before service is called
- **Never** catch and swallow: every `catch` must log and rethrow or return a failure result
- **Never** use exceptions for domain flow control (e.g. `throw new NotFoundError(...)` from service)
