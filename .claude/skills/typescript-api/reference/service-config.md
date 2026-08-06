# TypeScript REST API — Config Reference

## Directory Layout

```
my-api/
├── package.json
├── tsconfig.json                 # Build config — src/ only, outputs to dist/
├── tsconfig.test.json            # Type-check config — includes src/ + test/ for ESLint
├── vitest.config.ts
├── eslint.config.js              # ESLint 9 flat config (root rules + test-scoped override)
├── .prettierrc.json
├── .prettierignore               # dist/, migrations/ — generated output, not source
├── .env.example
├── drizzle.config.ts
├── src/
│   ├── app.ts                    # loadApp() factory — plugins, error mapper, routes
│   ├── server.ts                 # Entry point — loadApp() → initDb() → listen(); signals
│   ├── config.ts                 # Zod-validated env config (fails fast at startup)
│   ├── logger.ts                 # Shared Pino singleton
│   ├── db.ts                     # initDb()/getDb()/closeDb() — not a module-level singleton
│   ├── routes/
│   │   ├── work-items.ts         # createWorkItemsRouter(deps)
│   │   └── health.ts             # createHealthRouter(checkDb) — /, /live, /ready, /startup
│   ├── services/
│   │   ├── work-item.service.ts
│   │   └── work-item.service.interface.ts
│   ├── repositories/
│   │   ├── work-item.repository.ts
│   │   └── work-item.repository.interface.ts
│   ├── domain/
│   │   ├── work-item.ts          # Aggregate + branded ID + factory
│   │   └── errors.ts             # Result<T>/ok/fail — optional, internal use only
│   ├── errors/                   # ExtendableError subclasses + envelope
│   │   ├── ExtendableError.ts
│   │   ├── codes.ts
│   │   ├── types.ts
│   │   ├── domain.ts
│   │   └── helpers.ts
│   ├── middleware/
│   │   └── typedErrorMapper.ts
│   ├── validation/               # OPTIONAL — Shape A parse-and-throw requests
│   │   └── update-work-item-request.ts
│   ├── validation-schema/        # Zod schemas (HTTP layer)
│   │   └── work-items.schema.ts
│   └── schema/                   # Drizzle table definitions (DB layer) — same filename,
│       └── work-items.schema.ts  # different directory; the import path names the layer
├── migrations/                   # drizzle-kit generated SQL
└── test/
    ├── unit/
    │   └── work-item.service.test.ts
    └── integration/
        └── work-items.routes.test.ts
Dockerfile
docker-compose.yml
```

Which reference file owns each of these: see the Reference Files table in `SKILL.md`.

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

> **Exact pins — no `^` or `~`.** A caret range lets any bare `npm install` (fresh clone, CI
> cache miss, Docker layer rebuild) resolve a newer minor than what was last tested; `npm ci`
> respects the lockfile but not every workflow uses it. Exact pins make each bump a reviewable
> diff line.
>
> **Constraints when bumping.** `@vitest/coverage-v8` MUST equal `vitest` exactly — its own
> peer range pins the identical version string, not a range. `typescript-eslint@8`'s peer range
> is `typescript >=4.8.4 <6.1.0`, so TypeScript 7 breaks linting. The versions above are the
> highest release within each major this skill documents in prose (Fastify v5, Zod v3, ESLint 9
> flat config, typescript-eslint v8, Vitest 3, TS 5.x); moving a major invalidates
> version-specific explanations elsewhere in this file. Re-verify against the registry — don't
> assume these stay current.

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

> `noUncheckedIndexedAccess` adds `undefined` to array index access — prevents off-by-one
> crashes at runtime. `exactOptionalPropertyTypes` disallows explicitly assigning `undefined`
> to an optional property — catches accidental overwrites. `rootDir`/`include` restrict the
> build to source so tests never land in `dist/`.

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

> Widens `rootDir` to `.` so `test/` is in scope; `noEmit` means this config never produces
> output. ESLint's `projectService` uses it to type-check test files (see `eslint.config.js`).

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

> Vitest resolves `.js` extension imports to `.ts` sources automatically — no alias config.
> `environment: 'node'` makes `crypto.randomUUID()` and other Node globals available.
>
> `restoreMocks: true` calls `vi.restoreAllMocks()` before every test, preventing call history
> or return-value overrides from leaking between tests. **It has a sharp edge with
> `vi.mock()`-factory mocks** — they revert to a no-op, not to the factory's implementation. See
> `reference/service-tests.md` for the `beforeEach` re-arm this requires.

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
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_SSL: z.coerce.boolean().default(false),
});

// Throws at startup if required env vars are missing or invalid.
// Never access process.env directly elsewhere — import `config` instead.
export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;

// One entry per schema key, no more, no less — Record<keyof Config, …> makes an omission a
// compile error instead of a runtime gap. Anything holding a credential, token, or secret
// (DATABASE_URL embeds a Postgres password) MUST be sensitive: true.
const fieldMeta: Record<keyof Config, { sensitive: boolean }> = {
  NODE_ENV: { sensitive: false },
  PORT: { sensitive: false },
  LOG_LEVEL: { sensitive: false },
  DATABASE_URL: { sensitive: true },
  DB_POOL_MAX: { sensitive: false },
  DB_IDLE_TIMEOUT_MS: { sensitive: false },
  DATABASE_SSL: { sensitive: false },
};

// Redacted view of `config` — the ONLY form allowed in logs, health/debug endpoints, or any
// *.json output. Never JSON.stringify(config) or pass `config` itself to a logger; that
// bypasses redaction and leaks credentials into log aggregators or served JSON.
export function getProperties(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      fieldMeta[key as keyof Config].sensitive ? '***REDACTED***' : value,
    ]),
  );
}
```

> This is the single canonical env schema — the optional references (`service-clients.md`,
> `service-observability.md`) list the keys they add to it. Adding a key without a matching
> `fieldMeta` entry fails `tsc`, not code review. `DATABASE_SSL=true` uses
> `{ rejectUnauthorized: true }` in `db.ts` — a real certificate check; fix a bad cert or CA
> bundle rather than weakening it.

## .env.example

```dotenv
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL=postgres://myapi:secret@localhost:5432/myapi_dev
DB_POOL_MAX=10
DB_IDLE_TIMEOUT_MS=30000
DATABASE_SSL=false
```

---

## Other Core Source Files

| File | Reference |
|------|-----------|
| `src/db.ts` | `reference/service-database.md` — `initDb()/getDb()/closeDb()`, `DbClient`, forbidden patterns |
| `src/app.ts` | `reference/service-app.md` — `loadApp()`, plugin/hook wiring order, logger |
| `src/server.ts` | `reference/service-lifecycle.md` — entry point, migrations, SIGTERM/SIGINT |
| `src/schema/*.schema.ts` | `reference/service-database.md` — Drizzle tables, schema-as-code conventions |

---

## drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';

// Read DATABASE_URL directly — do NOT import src/config.js here. It runs
// z.parse(process.env) at import time, requiring ALL app env vars; drizzle-kit only
// needs DATABASE_URL, so importing config would crash CI migration jobs.
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

> Never import `src/config.js` from a tooling config (`drizzle.config.ts`, `vitest.config.ts`,
> `eslint.config.js`) — these run outside the app process and can't satisfy the full env schema.
> `process.env['DATABASE_URL']` is safe under `noUncheckedIndexedAccess`: it returns
> `string | undefined` and the guard narrows it.

---

## eslint.config.js

```javascript
// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ── Root rules: all source and test TypeScript files ───────────────────────
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: {
          // tsconfig.test.json is not named tsconfig.json, so the project service won't
          // find it by directory traversal. allowDefaultProject covers test files that
          // fall through; defaultProject points at the test config.
          allowDefaultProject: ['*.js', 'test/*/*.ts'],
          defaultProject: 'tsconfig.test.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce `import type` for type-only imports (keeps the runtime bundle clean)
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // Ban explicit `any` — use `unknown` and narrow instead
      '@typescript-eslint/no-explicit-any': 'error',
      // Unused vars are bugs; prefix with _ to intentionally ignore
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  // ── Test-scoped override ───────────────────────────────────────────────────
  // vi.fn() mocks have no real `this` binding — unbound-method is a false positive here.
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
```

> ESLint 9 is **flat config only** — never create `.eslintrc.js` or `test/.eslintrc.js`;
> ESLint 9 doesn't load them and they become dead config. The legacy "root vs. tests" file split
> is expressed above as two objects in the same exported array.
>
> `typescript-eslint` v8 is the unified package replacing the `@typescript-eslint/parser` +
> `@typescript-eslint/eslint-plugin` pair. `recommendedTypeChecked` needs type information, so
> `parserOptions.projectService` is required — and plain `projectService: true` is **not**
> sufficient given `tsconfig.test.json`'s non-standard name. `allowDefaultProject` must not use
> `**` (banned for performance); `test/*/*.ts` covers the standard `test/unit/` +
> `test/integration/` layout.

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

> Prettier owns formatting only — no ESLint rule above is stylistic, so there's no overlap to
> disable. `dist/` and `migrations/` are generated; formatting them risks rewriting a
> drizzle-kit migration byte-for-byte on every run.

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

> The `build` stage type-checks before compiling — a bad type is a failed image. The `runtime`
> stage installs production deps only.

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

> `service_healthy` prevents the app from starting before PostgreSQL accepts connections —
> without it, `initDb()`'s fail-fast check crashes the container on first boot.
