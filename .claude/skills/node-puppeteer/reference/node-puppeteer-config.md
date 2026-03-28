# Node.js Puppeteer — Build & Configuration

## Directory Layout

```
my-automation/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── .env.example
├── src/
│   ├── main.ts                    # Entry point — browser lifecycle + task orchestration
│   ├── config.ts                  # Zod-validated env config (fails fast at startup)
│   ├── browser/
│   │   ├── browser-manager.ts     # BrowserManager singleton — launch, createContext, close
│   │   └── types.ts               # Branded types: PageUrl, Selector
│   ├── pages/                     # Page Object classes — one per page/flow
│   │   └── base-page.ts           # BasePage — shared nav, screenshot, wait helpers
│   ├── tasks/                     # Orchestration — compose page objects into workflows
│   │   └── example.task.ts
│   ├── schemas/                   # Zod schemas for scraped data shapes
│   │   └── example.schema.ts
│   └── logger.ts                  # Pino structured logger singleton
└── test/
    ├── unit/
    │   └── example.task.test.ts   # Mocked Page — pure logic tests
    └── integration/
        └── example.page.test.ts   # Real browser — headed or headless
Dockerfile
docker-compose.yml
```

---

## `package.json`

```json
{
  "name": "my-automation",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "tsc --project tsconfig.json",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src test",
    "screenshot": "tsx src/tasks/screenshot.task.ts"
  },
  "dependencies": {
    "puppeteer": "^23.0.0",
    "zod": "^3.23.0",
    "pino": "^9.0.0",
    "p-limit": "^6.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "eslint": "^9.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

---

## `tsconfig.json`

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
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

---

## `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
    },
    // Integration tests launch a real browser — run sequentially
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
```

---

## `.env.example`

```dotenv
# Browser
PUPPETEER_HEADLESS=true
PUPPETEER_SLOW_MO=0
PUPPETEER_TIMEOUT=30000
PUPPETEER_VIEWPORT_WIDTH=1280
PUPPETEER_VIEWPORT_HEIGHT=800

# Concurrency
MAX_CONCURRENT_PAGES=3

# Output
SCREENSHOT_DIR=./screenshots

# Logging
LOG_LEVEL=info
```

---

## `src/config.ts`

```typescript
import { z } from 'zod';

const configSchema = z.object({
  puppeteer: z.object({
    headless: z.string().transform(v => v !== 'false').default('true'),
    slowMo: z.coerce.number().default(0),
    timeout: z.coerce.number().default(30_000),
    viewport: z.object({
      width: z.coerce.number().default(1280),
      height: z.coerce.number().default(800),
    }),
  }),
  concurrency: z.object({
    maxPages: z.coerce.number().min(1).max(10).default(3),
  }),
  output: z.object({
    screenshotDir: z.string().default('./screenshots'),
  }),
  log: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

export const config = configSchema.parse({
  puppeteer: {
    headless: process.env['PUPPETEER_HEADLESS'],
    slowMo: process.env['PUPPETEER_SLOW_MO'],
    timeout: process.env['PUPPETEER_TIMEOUT'],
    viewport: {
      width: process.env['PUPPETEER_VIEWPORT_WIDTH'],
      height: process.env['PUPPETEER_VIEWPORT_HEIGHT'],
    },
  },
  concurrency: {
    maxPages: process.env['MAX_CONCURRENT_PAGES'],
  },
  output: {
    screenshotDir: process.env['SCREENSHOT_DIR'],
  },
  log: {
    level: process.env['LOG_LEVEL'],
  },
});
```

---

## `src/logger.ts`

```typescript
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.log.level,
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
```

---

## `Dockerfile`

```dockerfile
FROM node:20-slim AS base

# Install Chromium dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY .env.example .env

ENV NODE_ENV=production
ENV PUPPETEER_HEADLESS=true

CMD ["node", "dist/main.js"]
```

---

## `docker-compose.yml`

```yaml
version: '3.9'
services:
  automation:
    build: .
    environment:
      - PUPPETEER_HEADLESS=true
      - MAX_CONCURRENT_PAGES=3
      - LOG_LEVEL=info
    volumes:
      - ./screenshots:/app/screenshots
    shm_size: '2gb'   # Chrome requires shared memory — crucial in Docker
```
