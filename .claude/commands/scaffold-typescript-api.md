---
description: Scaffold a new Node.js TypeScript REST API with Fastify v5, Zod, Drizzle ORM, Vitest, and a sample endpoint
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs
disable-model-invocation: true
---

# Scaffold TypeScript REST API (Fastify + Zod + Drizzle + Vitest)

**Project name:** $ARGUMENTS (default to "my-api" if not provided)

Delegate to the `typescript-api` skill for all patterns, templates, and reference files.

## Pre-requisites

1. Read the `typescript-api` skill (`SKILL.md` and all reference files) before writing any code.
2. Use Context7 MCP (`resolve-library-id` then `query-docs`) to verify current Fastify, Zod, and Drizzle APIs before generating code. Key libraries: `fastify/fastify`, `colinhacks/zod`, `drizzle-team/drizzle-orm`.
3. Verify Node.js 24 ESM patterns (`"type": "module"`, `.js` extensions in imports, `import.meta.url`) against Context7 — do NOT generate CommonJS patterns (`require`, `module.exports`, `__dirname`).

> **Naming note:** The scaffold uses `WorkItem` as the sample domain class. When adapting for your own domain, avoid names that shadow Node.js built-ins or common package names.

## Steps

1. **Create project directory and initialise npm** — Run:
   ```bash
   mkdir $ARGUMENTS && cd $ARGUMENTS
   npm init -y
   ```
   Update `package.json` per skill config reference (`reference/typescript-api-config.md`): set `"type": "module"`, `"engines": { "node": ">=24.0.0" }`, and all scripts (`dev`, `build`, `start`, `typecheck`, `test`, `lint`, `db:generate`, `db:migrate`, `db:studio`). Pin exact package versions from the reference.

2. **Install dependencies** — Install production deps:
   ```bash
   npm install fastify @fastify/sensible fastify-type-provider-zod zod drizzle-orm postgres pino
   ```
   Install dev deps:
   ```bash
   npm install -D typescript tsx @types/node vitest @vitest/coverage-v8 drizzle-kit eslint typescript-eslint pino-pretty
   ```
   Read `reference/typescript-api-config.md` for exact versions.

3. **Create TypeScript configuration** — Create `tsconfig.json` (build config, `src/` only, `outDir: dist`) and `tsconfig.test.json` (extends build config, widens `rootDir` to `.`, adds `test/`, sets `noEmit: true`). Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Module system: `NodeNext`/`NodeNext`. Read `reference/typescript-api-config.md` for exact compiler options.

4. **Create Vitest configuration** — Create `vitest.config.ts` with `environment: 'node'`, `coverage.provider: 'v8'`, `coverage.include: ['src/**/*.ts']`. Also set test environment variables so the config module doesn't throw when `DATABASE_URL` is absent in CI:
   ```typescript
   test: {
     env: {
       NODE_ENV: 'test',
       DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
       PORT: '3000',
       LOG_LEVEL: 'error',
     },
   }
   ```
   Read `reference/typescript-api-config.md` for the full template.

5. **Create ESLint configuration** — Create `eslint.config.js` using ESLint 9 flat config with `typescript-eslint`. Enable `recommendedTypeChecked` and rules: `consistent-type-imports`, `no-explicit-any: error`, `no-unused-vars`, `no-floating-promises`. IMPORTANT — do NOT use `projectService: true`; use the object form with `allowDefaultProject` and `defaultProject` so ESLint can find test files (see note below):
   ```javascript
   projectService: {
     allowDefaultProject: ['*.js', 'test/*/*.ts'],
     defaultProject: 'tsconfig.test.json',
   }
   ```
   Also add a test-files override block that disables `unbound-method` — `vi.fn()` mocks have no real `this` binding, so the rule is a false positive in tests. Read `reference/typescript-api-config.md` for the exact template.
   > **Why not `projectService: true`?** `tsconfig.test.json` is not named `tsconfig.json` so TypeScript's project service won't find it by directory traversal. `allowDefaultProject` covers test files that fall through. `allowDefaultProject` must NOT use `**` (banned for performance); `test/*/*.ts` covers the standard `test/unit/` + `test/integration/` layout.

6. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to TypeScript/Node or general cross-cutting concerns like `code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`, and `code-reviewer`.

7. **Create directory structure** — Create all directories upfront:
   ```
   src/domain/
   src/repositories/
   src/services/
   src/routes/
   src/schema/
   test/unit/
   test/integration/
   migrations/
   ```

8. **Create `src/config.ts`** — Zod-validated env schema with `NODE_ENV`, `PORT`, `DATABASE_URL`, `LOG_LEVEL`. Call `z.parse(process.env)` at module level — throws at startup if required vars are missing. Export typed `config` constant. Never read `process.env` directly anywhere else. Read `reference/typescript-api-config.md` for the exact template.

9. **Create `src/domain/errors.ts`** — `AppError` discriminated union (`NotFound`, `ValidationError`, `Conflict`). `Result<T, E>` type with `ok` and `fail` helper functions. **Do not add HTTP status mappings here** — the domain has no knowledge of HTTP. That mapping lives in the route plugin. Read `reference/typescript-api-domain.md` for the exact template.

10. **Create `src/domain/work-item.ts`** — `WorkItemId` branded type with `newWorkItemId()` and `workItemIdFrom()` factories. `WorkItem` interface (readonly fields). `createWorkItem(title)` factory and `reconstituteWorkItem(...)` for persistence mapping. Read `reference/typescript-api-domain.md` for the exact template.

11. **Create `src/schema/work-items.schema.ts`** — Drizzle `pgTable` definition for `work_items` with `uuid` PK, `text` title, `timestamp with timezone` createdAt. Export `WorkItemRow` and `NewWorkItemRow` inferred types. Read `reference/typescript-api-config.md` for the exact template.

12. **Create `src/db.ts`** — Drizzle client singleton using `postgres` driver. Configure pool size (`max: 10`) and `idle_timeout`. Import `config` for `DATABASE_URL`. Export typed `Db` type. Read `reference/typescript-api-config.md` for the exact template.

13. **Create `drizzle.config.ts`** — Drizzle Kit config reading `DATABASE_URL` directly from `process.env` (do NOT import `src/config.ts` — it would require all env vars to be set in migration-only CI jobs). Fail with a clear error if `DATABASE_URL` is missing. Read `reference/typescript-api-config.md` for the exact template.

14. **Create `src/repositories/work-item.repository.interface.ts`** — `IWorkItemRepository` interface with `findAll`, `findById`, `save`, `deleteById`. No Drizzle imports — depends only on domain types. Read `reference/typescript-api-domain.md` for the exact template.

15. **Create `src/repositories/work-item.repository.ts`** — `DrizzleWorkItemRepository` implementing the interface. Use `reconstituteWorkItem` at the repository boundary — never expose raw Drizzle row types to callers. Guard `rows[0]` with a ternary (required by `noUncheckedIndexedAccess`). Read `reference/typescript-api-implementation.md` for the exact template.

16. **Create `src/services/work-item.service.interface.ts`** — `IWorkItemService` interface returning `Promise<Result<T>>` for fallible methods, `Promise<readonly WorkItem[]>` for `listAll` (never fails). Read `reference/typescript-api-domain.md` for the exact template.

17. **Create `src/services/work-item.service.ts`** — `WorkItemService` implementing the interface. Return `Result<T>` — never throw for domain errors. Log at `warn` for expected failures, `info` for mutations, `debug` for reads. Pass `IWorkItemRepository` and `Logger` via constructor. Read `reference/typescript-api-implementation.md` for the exact template.

18. **Create `src/routes/work-items.ts`** — `workItemsPlugin` factory function returning a **`FastifyPluginCallbackZod`** (NOT `FastifyPluginAsyncZod` — route registration is synchronous; `async` with no `await` triggers `@typescript-eslint/require-await`). The callback pattern requires `(app, _opts, done)` signature and `done()` at the end of the function body. Define `statusFor(error: AppError): number` as a **local function** in this file (HTTP concern — not in the domain layer). Extract a shared `ProblemDetailsSchema` constant for RFC 7807 error bodies. Declare full response schemas for all status codes on every route (200/404 for GET `:id`, 201/400 for POST, 204/404 for DELETE). Read `reference/typescript-api-implementation.md` for the exact template.

19. **Create `src/main.ts`** — `buildApp(deps: AppDeps)` factory (exported for tests). Run `migrate(db, { migrationsFolder: './migrations' })` at startup, guarded by `NODE_ENV !== 'test'`. Register `setValidatorCompiler`/`setSerializerCompiler` from `fastify-type-provider-zod`. Register `@fastify/sensible`. Set RFC 7807 `setErrorHandler`. Register `workItemsPlugin` and health check **both via `app.register(..., { prefix: '/api/v1' })`** — never hardcode the prefix path directly. The health check must also use the **callback pattern** (not `async`): `(api, _opts, done) => { api.get(...); done(); }`. Guard `app.listen` with `import.meta.url` check so tests don't start the server. Read `reference/typescript-api-config.md` for the exact template.

20. **Generate first migration** — Create the initial migration SQL file:
    ```bash
    npm run db:generate
    ```
    Verify `migrations/` contains a `.sql` file for the `work_items` table.

21. **Add `.gitignore`** — Cover: `node_modules/`, `dist/`, `coverage/`, `.env`, `*.local`, `.DS_Store`, `*.log`, `drizzle/`.

22. **Add `.env.example`** — Include all four vars from the config schema: `NODE_ENV`, `PORT`, `DATABASE_URL`, `LOG_LEVEL`. Read `reference/typescript-api-config.md` for the template.

23. **Add Docker support** — Two-stage `Dockerfile`: `node:24-alpine` build stage (type-check + compile) and `node:24-alpine` runtime stage (`npm ci --omit=dev`). Copy `migrations/` into the runtime image — they are read by `drizzle-orm/postgres-js/migrator` at startup. Create `docker-compose.yml` with app and `postgres:17-alpine` services, health checks on both, and `depends_on: db: condition: service_healthy`. Read `reference/typescript-api-config.md` for exact templates.

24. **Write unit tests** — Create `test/unit/work-item.service.test.ts`. Use `vi.fn()` stubs for `IWorkItemRepository`. Type the logger stub as `as unknown as Logger` (import `Logger` from `pino`) — never use `as any`. Wrap spy references with `vi.mocked()` when passing to `expect()` (avoids `unbound-method` lint). Use `Promise.resolve(value)` not `async () => value` in mock implementations (avoids `require-await` lint). Cover:
    - `listAll` returns repository result
    - `getById` returns `ok(item)` when found; `fail({ kind: 'NotFound' })` when missing
    - `create` with valid title returns created item with trimmed title and calls `save`
    - `create` with blank/whitespace title returns `fail({ kind: 'ValidationError' })` without calling `save` (use `it.each`)
    - `delete` returns `ok(true)` when deleted; `fail({ kind: 'NotFound' })` when missing
    Read `reference/typescript-api-tests.md` for the exact template.

25. **Write integration tests** — Create `test/integration/work-items.routes.test.ts`. Use `buildApp({ service: makeStubService(...) })` and `app.inject()` — no real TCP port, no real DB. In `mockImplementation` callbacks, always type the parameter explicitly (e.g. `(id: WorkItemId)`) — untyped params are `any` and trigger `no-unsafe-assignment`. Use `Promise.resolve(...)` not `async (id) =>` — avoids `require-await`. Cover:
    - `POST /api/v1/workitems` → 201 with valid title; 400 with empty title; 400 with missing title field
    - `GET /api/v1/workitems/:id` → 200 when found; 404 for unknown ID; 400 for invalid UUID
    - `DELETE /api/v1/workitems/:id` → 204 when deleted; 404 when not found
    Always call `app.close()` in `afterAll`. Read `reference/typescript-api-tests.md` for the exact template.

26. **Verify** — Run `npm run typecheck` (zero errors), `npm run lint` (zero warnings), `npm test` (all green). Fix any issues before reporting done.

27. **Print summary** — List all created files with one-line descriptions. Print `npm run dev` to start (port 3000). List the API endpoints (`GET/POST /api/v1/workitems`, `GET/DELETE /api/v1/workitems/:id`, `GET /api/v1/health`). Note next steps: add `DATABASE_URL` to `.env` and run `npm run db:migrate` before first use, add JWT auth via `@fastify/jwt`, add OpenAPI spec via `@fastify/swagger`, add rate limiting via `@fastify/rate-limit`.
