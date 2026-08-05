# TypeScript REST API — Config Reference

## Directory Layout

```
my-api/
├── package.json
├── tsconfig.json                 # Build config — src/ only, outputs to dist/
├── tsconfig.test.json            # Type-check config — includes src/ + test/ for ESLint
├── vitest.config.ts              # Vitest config — coverage provider, test environment
├── eslint.config.js              # ESLint 9 flat config (root rules + a test-scoped override block)
├── .prettierrc.json              # Prettier formatting config
├── .prettierignore               # dist/, migrations/ — generated output, not source
├── .env.example
├── drizzle.config.ts             # Drizzle Kit configuration
├── src/
│   ├── app.ts                    # loadApp() factory — plugins, error mapper, routes; no resource access
│   ├── server.ts                 # Entry point — loadApp() → initDb() → listen(); SIGTERM/SIGINT handler
│   ├── config.ts                 # Zod-validated env config (fails fast at startup)
│   ├── db.ts                     # initDb()/getDb()/closeDb() lifecycle — not a module-level singleton
│   ├── routes/
│   │   ├── work-items.ts         # createWorkItemsRouter(deps) — see reference/service-implementation.md
│   │   └── health.ts             # createHealthRouter(checkDb) — /live, /ready, /startup
│   ├── services/
│   │   ├── work-item.service.ts
│   │   └── work-item.service.interface.ts
│   ├── repositories/
│   │   ├── work-item.repository.ts
│   │   └── work-item.repository.interface.ts
│   ├── domain/
│   │   ├── work-item.ts          # Aggregate + branded ID + factory
│   │   └── errors.ts             # Result<T>/ok/fail — optional, internal use only
│   ├── errors/                   # ExtendableError subclasses + envelope — see reference/service-errors.md
│   │   ├── ExtendableError.ts
│   │   ├── codes.ts              # reason_code registry
│   │   ├── types.ts              # ErrorEnvelope + ValidationErrorEnvelope
│   │   ├── domain.ts             # NotFoundError, DomainValidationError, ConflictError
│   │   └── helpers.ts            # sendValidationError()
│   ├── middleware/
│   │   └── typedErrorMapper.ts   # registerErrorMapper — see reference/service-errors.md
│   ├── validation/                # OPTIONAL — Shape A parse-and-throw requests, see service-errors.md
│   │   └── update-work-item-request.ts
│   ├── validation-schema/         # Zod schemas (HTTP layer) — see service-implementation.md
│   │   └── work-items.schema.ts  # *Schema naming + inferred types
│   └── schema/                    # Drizzle table definitions (DB layer) — see service-database.md
│       └── work-items.schema.ts  # Drizzle table schema — same filename, different directory:
│                                  # validation-schema/ (Zod, HTTP) vs schema/ (Drizzle, DB)
├── migrations/                   # drizzle-kit generated SQL files
└── test/
    ├── unit/
    │   └── work-item.service.test.ts
    └── integration/
        └── work-items.routes.test.ts
Dockerfile
docker-compose.yml
```

---

## package.json

```json
{
  "name": "my-api",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc --project tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@fastify/sensible": "6.0.4",
    "fastify-type-provider-zod": "4.0.2",
    "drizzle-orm": "0.44.7",
    "fastify": "5.11.2",
    "pg": "8.22.0",
    "pino": "9.14.0",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@types/pg": "8.20.4",
    "@vitest/coverage-v8": "3.2.7",
    "drizzle-kit": "0.30.6",
    "eslint": "9.39.5",
    "pino-pretty": "13.1.3",
    "prettier": "3.9.6",
    "typescript-eslint": "8.66.0",
    "tsx": "4.23.6",
    "typescript": "5.9.3",
    "vitest": "3.2.7"
  }
}
```

> **Every dependency is pinned to an exact version — no `^` or `~`.** A caret range lets
> `npm install` (a fresh clone, a CI cache miss, a Docker layer rebuild) silently resolve to a
> newer minor/patch than what was last tested, even with a committed `package-lock.json` present
> — `npm ci` respects the lockfile, but any workflow that runs a bare `npm install` (or a dependency
> gets manually re-resolved) can drift. Exact pins make every version bump an explicit, reviewable
> line in a diff instead of a transparent side effect of installing.
>
> **Versions above were verified against the npm registry, not carried over unchanged.** Each is
> the highest release within the major version this skill already documents and depends on in
> prose elsewhere (Fastify v5, Zod v3, ESLint 9 flat config, `typescript-eslint` v8, Vitest 3,
> TypeScript 5.x) — jumping any of these to the newest major available on the registry (Zod 4,
> ESLint 10, Vitest 4, TypeScript 7, `fastify-type-provider-zod` 7) was deliberately rejected:
> `typescript-eslint@8.66.0`'s peer range is `typescript: '>=4.8.4 <6.1.0'`, so TypeScript 7 would
> break linting outright, and the other majors would invalidate the version-specific explanations
> written throughout this file (e.g. "ESLint 9 uses flat config"). `@vitest/coverage-v8` MUST
> match `vitest`'s version exactly — its own `peerDependencies` pins `vitest` to the identical
> version string, not a range. Re-verify and bump deliberately; don't assume these stay current.
>
> No `killport`-style process-killing script is included — none of the commands above bind a
> port outside of `dev`/`start`, and `tsx watch` / the runtime process own their own lifecycle.
> If a workflow needs to free a stuck port, that's a one-off shell command, not a maintained
> `package.json` script.

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

> `noUncheckedIndexedAccess` adds `undefined` to array index access returns — prevents
> off-by-one crashes at runtime. `exactOptionalPropertyTypes` disallows assigning `undefined`
> to an optional property explicitly — catches accidental overwrites.
>
> `rootDir: "src"` and `include: ["src"]` restrict the build to source files only.
> Tests are excluded so they don't end up in `dist/`. See `tsconfig.test.json` for the
> type-check config that covers `test/` — used by ESLint's `projectService`.

---

## tsconfig.test.json

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src", "test"],
  "exclude": ["node_modules", "dist"]
}
```

> Extends the build tsconfig but widens `rootDir` to `.` so `test/` files are in scope.
> `noEmit: true` overrides the build config — this file is **never** used to produce output.
> ESLint's `projectService` uses `allowDefaultProject` + `defaultProject: 'tsconfig.test.json'`
> to type-check test files — see `eslint.config.js` template for the required configuration.

---

## vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
```

> Vitest resolves `.js` extension imports to `.ts` source files automatically — no alias
> config required. The `environment: 'node'` setting ensures `crypto.randomUUID()` and
> other Node globals are available in tests. Coverage is scoped to `src/` only; test
> files are excluded from coverage reports.
>
> `restoreMocks: true` calls `vi.restoreAllMocks()` before every test — prevents a mock's
> call history or return-value override in one test from leaking into the next. **Gotcha:**
> for a `vi.fn()` created inside a `vi.mock('./x.js', () => ({ ... }))` factory, "restore"
> doesn't mean "back to the factory's initial implementation" — there is no original to
> restore to, so it reverts to a no-op returning `undefined`. Any test after the first one
> in a file that relies on that mock's return value breaks silently unless it's re-armed. See
> `reference/service-tests.md` for the `beforeEach` pattern this requires.

---

## src/config.ts

```typescript
import { z } from 'zod';

// Every key below MUST correspond to a real environment variable — this schema is a direct
// map of env var name → validator, nothing more. Never add a derived/computed key here;
// compute derived values from `config` after parsing, in a separate export.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

// Throws at startup if required env vars are missing or invalid.
// Never access process.env directly elsewhere — import `config` instead.
export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;

// One entry per schema key, no more, no less — `Record<keyof Config, …>` makes an omission
// a compile error instead of a runtime gap. Anything holding a credential, token, or secret
// (DATABASE_URL embeds a Postgres password) MUST be `sensitive: true`.
const fieldMeta: Record<keyof Config, { sensitive: boolean }> = {
  NODE_ENV: { sensitive: false },
  PORT: { sensitive: false },
  DATABASE_URL: { sensitive: true },
  LOG_LEVEL: { sensitive: false },
};

// Redacted view of `config` — the ONLY form of config allowed in logs, health/debug endpoints,
// or any *.json output. Never `JSON.stringify(config)` or pass `config` itself to a logger;
// that bypasses redaction and leaks credentials into log aggregators or served JSON.
export function getProperties(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      fieldMeta[key as keyof Config].sensitive ? '***REDACTED***' : value,
    ]),
  );
}
```

> Import `config` everywhere instead of reading `process.env` directly.
> The parse call throws a `ZodError` at startup — crashes loudly before serving a single request.
>
> `getProperties()` exists so credentials never appear in `*.json` config files or log output:
> anywhere config needs to be serialized, dumped, or logged — a debug endpoint, a startup log
> line, a support bundle — call `getProperties()`, never `config` directly. Adding a new env var
> to `envSchema` without adding a matching `fieldMeta` entry fails `tsc`, not a code review.

---

## src/db.ts

See `reference/service-database.md` for the full `initDb()/getDb()/closeDb()` implementation,
`DbClient = Db | TX` type definition, DB config env vars with TLS defaults, and forbidden patterns.

---

## src/app.ts

```typescript
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { config } from './config.js';
import { checkDb } from './db.js';
import { DrizzleWorkItemRepository } from './repositories/work-item.repository.js';
import { WorkItemService } from './services/work-item.service.js';
import type { IWorkItemService } from './services/work-item.service.interface.js';
import { createWorkItemsRouter } from './routes/work-items.js';
import { createHealthRouter } from './routes/health.js';
import { registerErrorMapper } from './middleware/typedErrorMapper.js';
import { ReasonCode } from './errors/codes.js';
import type { ErrorEnvelope } from './errors/types.js';

// Optional deps allow tests to inject stub implementations without vi.mock()
interface AppDeps {
  service?: IWorkItemService;
}

// No resource access here — initDb() runs in server.ts, after this factory returns.
// Integration tests call loadApp() directly and never touch the database (see
// reference/service-database.md, "Startup Sequence").
export async function loadApp(deps: AppDeps = {}) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
    },
  });

  // ── Type provider ──────────────────────────────────────────────────────────
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(sensible);

  // ── 404 + error handler ────────────────────────────────────────────────────
  // setNotFoundHandler first, then registerErrorMapper — see reference/service-errors.md
  // for the full ErrorEnvelope/ExtendableError model. No ad-hoc reply.status(4xx).send({...})
  // anywhere in this file — that's the named anti-pattern; typedErrorMapper owns every status.
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      message: `Route ${request.method}:${request.url} not found`,
      reason_code: ReasonCode.NotFound,
    } satisfies ErrorEnvelope);
  });
  registerErrorMapper(app);

  // ── Dependencies ───────────────────────────────────────────────────────────
  // DrizzleWorkItemRepository takes no db — db is injected per call by the service
  // (see reference/service-database.md, "Repository Signatures — DbClient Pattern").
  const repository = new DrizzleWorkItemRepository(app.log);
  const service = deps.service ?? new WorkItemService(repository, app.log);

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(createWorkItemsRouter({ service }), { prefix: '/api/v1' });

  // ── Health probes ──────────────────────────────────────────────────────────
  // Unprefixed (/live, /ready, /startup) — deliberately NOT under /api/v1. See
  // reference/service-implementation.md, "Health Router", for why probes stay outside
  // API versioning/auth/business middleware. checkDb is injected, not imported directly,
  // so createHealthRouter itself never touches db.ts.
  await app.register(createHealthRouter(checkDb));

  return app;
}
```

> `loadApp()` is exported so both `server.ts` and integration tests can build a fully-wired
> Fastify instance without ever touching the database. This is the naming this skill's other
> reference files (`service-database.md`, `service-lifecycle.md`, `SKILL.md`) already assume —
> `app.ts`/`loadApp()`, not `main.ts`/`buildApp()`.
> `createWorkItemsRouter({ service })` — deps as an object even though there's only one field
> today — matches `WorkItemsRouterDeps`; `createHealthRouter(checkDb)` takes its one dependency
> positionally instead, per the single-dependency exception documented alongside it.

---

## src/server.ts

See `reference/service-lifecycle.md` for the full entry-point implementation: `loadApp()` →
`initDb()` → run pending migrations → `server.listen()`, plus the SIGTERM/SIGINT handler,
force-exit timer, and `closeIdleConnections()`.

> Migrations run in `server.ts`, **after** `initDb()` — never inside `loadApp()`. `loadApp()`
> has no DB access at all (see `src/app.ts` above); running `migrate()` there would mean every
> integration test needs a live database. The migrator import is
> `drizzle-orm/node-postgres/migrator` — matching the `pg`/`node-postgres` driver this skill
> uses (see `reference/service-database.md`), not `drizzle-orm/postgres-js/migrator`.

---

## src/schema/work-items.schema.ts

```typescript
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const workItems = pgTable('work_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkItemRow = typeof workItems.$inferSelect;
export type NewWorkItemRow = typeof workItems.$inferInsert;
```

---

## drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';

// Read DATABASE_URL directly — do NOT import src/config.js here.
// src/config.js executes z.parse(process.env) at import time, which requires
// ALL app env vars (NODE_ENV, LOG_LEVEL, PORT, …). drizzle-kit only needs
// DATABASE_URL, so importing config would crash CI migration jobs that only
// have the DB URL in scope.
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required for drizzle-kit');
}

export default defineConfig({
  schema: './src/schema/work-items.schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
```

> `process.env['DATABASE_URL']` is safe under `noUncheckedIndexedAccess` — the string
> key returns `string | undefined`, and the guard above narrows it to `string` before use.
> Never import `src/config.js` from tooling configs (`drizzle.config.ts`, `vitest.config.ts`,
> `eslint.config.js`) — these run outside the app process and cannot satisfy the full env schema.

---

## eslint.config.js

```javascript
// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ── Root rules: apply to all source and test TypeScript files ──────────────
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: {
          // `tsconfig.test.json` is not named `tsconfig.json`, so TypeScript's project
          // service won't find it by directory traversal. `allowDefaultProject` covers
          // test files that fall through, and `defaultProject` points to the test config.
          allowDefaultProject: ['*.js', 'test/*/*.ts'],
          defaultProject: 'tsconfig.test.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce `import type` for type-only imports (keeps runtime bundle clean)
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // Ban explicit `any` — use `unknown` and narrow instead
      '@typescript-eslint/no-explicit-any': 'error',
      // Unused vars are bugs; prefix with _ to intentionally ignore
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Prefer `Promise<void>` return over floating promises
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  // ── Test-scoped overrides: rules that only make sense inside test/ ─────────
  // In test files vi.fn() mocks have no real `this` binding — unbound-method is a false positive.
  // @vitest/eslint-plugin would handle this automatically; we replicate its behaviour here.
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  // Always ignore compiled output and deps
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
```

> ESLint 9 uses **flat config** (`eslint.config.js`) — no `.eslintrc` files. This is a single
> exported array, not one file per scope: **do not** create `.eslintrc.js` (root) or
> `tests/.eslintrc.js` files — ESLint 9 never loads them, and their presence next to a working
> `eslint.config.js` is dead config that silently does nothing. The "root vs. tests" split
> those legacy filenames implied is expressed above as two config objects in the same array:
> the first block (`files: ['src/**/*.ts', 'test/**/*.ts']`) is the root ruleset, the second
> (`files: ['test/**/*.ts']`) is the test-scoped override — same separation of concerns,
> flat-config idiom.
>
> `typescript-eslint` is the unified v8 package that replaces the separate
> `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` pair.
> `recommendedTypeChecked` enables rules that require type information (e.g. `no-floating-promises`) —
> this requires `parserOptions.projectService` to work. `projectService: true` is NOT sufficient
> here — `tsconfig.test.json` has a non-standard name so the service won't find it by traversal;
> `allowDefaultProject` + `defaultProject` are required.
> `allowDefaultProject` must NOT use `**` (banned for performance); use `test/*/*.ts` to cover
> the standard `test/unit/` and `test/integration/` layout.

---

## .prettierrc.json

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

## .prettierignore

```
dist
migrations
```

> `singleQuote` matches the quote style already implied by the ESLint rules above; keeping
> Prettier and ESLint aligned avoids the two tools fighting over the same line. Prettier owns
> formatting only — none of the ESLint rules in `eslint.config.js` are stylistic/formatting
> rules, so there's no rule overlap to disable. `dist/` and `migrations/` are generated output,
> not hand-written source — formatting them is wasted work and risks rewriting a drizzle-kit
> migration file byte-for-byte on every run.

---

## .env.example

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://myapi:secret@localhost:5432/myapi_dev
LOG_LEVEL=debug
```

---

## Dockerfile

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies (cached layer)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Type-check and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run typecheck && npm run build

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY migrations/ ./migrations/

EXPOSE 3000
ENTRYPOINT ["node", "dist/server.js"]
```

> Two-stage build: the `build` stage type-checks before compiling — a bad type is a
> failed image. The `runtime` stage installs only production deps, keeping the image small.

---

## docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: 3000
      DATABASE_URL: postgres://myapi:secret@db:5432/myapi_dev
      LOG_LEVEL: info
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/ready"]
      interval: 10s
      retries: 3

  db:
    image: postgres:17-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: myapi
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: myapi_dev
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapi -d myapi_dev"]
      interval: 5s
      retries: 5

volumes:
  pgdata:
```

> `service_healthy` on the `db` dependency prevents the app from starting before
> PostgreSQL is accepting connections. Without this, the app crashes on first DB call.
