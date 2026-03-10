# TypeScript REST API — Config Reference

## Directory Layout

```
my-api/
├── package.json
├── tsconfig.json                 # Build config — src/ only, outputs to dist/
├── tsconfig.test.json            # Type-check config — includes src/ + test/ for ESLint
├── vitest.config.ts              # Vitest config — coverage provider, test environment
├── eslint.config.js              # ESLint 9 flat config
├── .env.example
├── drizzle.config.ts             # Drizzle Kit configuration
├── src/
│   ├── main.ts                   # Entry point + app factory + plugin registration
│   ├── config.ts                 # Zod-validated env config (fails fast at startup)
│   ├── db.ts                     # Drizzle client singleton
│   ├── routes/
│   │   └── work-items.ts         # Fastify route plugin
│   ├── services/
│   │   ├── work-item.service.ts
│   │   └── work-item.service.interface.ts
│   ├── repositories/
│   │   ├── work-item.repository.ts
│   │   └── work-item.repository.interface.ts
│   ├── domain/
│   │   ├── work-item.ts          # Aggregate + branded ID + factory
│   │   └── errors.ts             # AppError discriminated union + Result type
│   └── schema/
│       └── work-items.schema.ts  # Drizzle table schema
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
    "dev": "tsx watch src/main.ts",
    "build": "tsc --project tsconfig.json",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint .",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@fastify/sensible": "^6.0.2",
    "@fastify/type-provider-zod": "^4.0.2",
    "drizzle-orm": "^0.44.0",
    "fastify": "^5.2.0",
    "pino": "^9.0.0",
    "postgres": "^3.4.5",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "drizzle-kit": "^0.30.0",
    "eslint": "^9.17.0",
    "pino-pretty": "^13.0.0",
    "typescript-eslint": "^8.18.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

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
>
> ESLint's `projectService: true` automatically selects `tsconfig.test.json` for files
> in `test/`, giving type-aware rules (`no-floating-promises`, `consistent-type-imports`)
> full type information in tests without a separate ESLint config block.

---

## vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
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

---

## src/config.ts

```typescript
import { z } from 'zod';

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
```

> Import `config` everywhere instead of reading `process.env` directly.
> The parse call throws a `ZodError` at startup — crashes loudly before serving a single request.

---

## src/db.ts

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from './config.js';
import * as schema from './schema/work-items.schema.js';

const client = postgres(config.DATABASE_URL, {
  max: 10,            // connection pool size
  idle_timeout: 30,   // seconds before idle connections are closed
});

export const db = drizzle(client, { schema });
export type Db = typeof db;
```

---

## src/main.ts

```typescript
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {
  serializerCompiler,
  validatorCompiler,
} from '@fastify/type-provider-zod';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { config } from './config.js';
import { db } from './db.js';
import { DrizzleWorkItemRepository } from './repositories/work-item.repository.js';
import { WorkItemService } from './services/work-item.service.js';
import type { IWorkItemService } from './services/work-item.service.interface.js';
import { workItemsPlugin } from './routes/work-items.js';

// Optional deps allow tests to inject stub implementations without vi.mock()
interface AppDeps {
  service?: IWorkItemService;
}

export async function buildApp(deps: AppDeps = {}) {
  // Run pending migrations before accepting traffic.
  // drizzle-orm/migrator reads the SQL files directly — drizzle-kit is not required at runtime.
  if (config.NODE_ENV !== 'test') {
    await migrate(db, { migrationsFolder: './migrations' });
  }

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

  // ── Error handler (RFC 7807 ProblemDetails) ────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');
    reply.status(error.statusCode ?? 500).send({
      type: 'https://tools.ietf.org/html/rfc7807',
      title: error.message ?? 'Internal Server Error',
      status: error.statusCode ?? 500,
      instance: request.url,
    });
  });

  // ── Dependencies ───────────────────────────────────────────────────────────
  const repository = new DrizzleWorkItemRepository(db, app.log);
  const service = deps.service ?? new WorkItemService(repository, app.log);

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(workItemsPlugin(service), { prefix: '/api/v1' });

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  return app;
}

// Only start the server when this file is the entry point (not in tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}
```

> `buildApp()` is exported so tests can call it without starting the HTTP server.
> `import.meta.url` guard prevents double-starting in test environments.

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
  // Apply type-aware rules to all source and test TypeScript files
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
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
  // Always ignore compiled output and deps
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
```

> ESLint 9 uses **flat config** (`eslint.config.js`) — no `.eslintrc` files.
> `typescript-eslint` is the unified v8 package that replaces the separate
> `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` pair.
> `recommendedTypeChecked` enables rules that require type information (e.g. `no-floating-promises`) —
> this requires `parserOptions.projectService: true` to work.

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
ENTRYPOINT ["node", "dist/main.js"]
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
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/v1/health"]
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
