---
name: node-puppeteer
description: Skill for Node.js v18+ + Puppeteer + TypeScript browser automation. Activate when building web scrapers, E2E workflows, screenshot/PDF pipelines, or Page Object Models with Puppeteer.
allowed-tools: Bash, Read, Glob, Grep
---

# Node.js v18+ Puppeteer Automation Skill (TypeScript)

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Runtime | Node.js v18+ | LTS, native ESM, `fetch` built-in, `--experimental-vm-modules` for Vitest |
| Language | TypeScript 5.x strict | Type-safe selectors, page objects, and scraped data shapes |
| Browser automation | Puppeteer v23+ | Full Chrome DevTools Protocol; first-class TypeScript types |
| Concurrency | `p-limit` | Prevent unbounded parallel page launches; memory-safe |
| Validation | Zod | Validate scraped DOM data at the boundary; runtime safety |
| Config | Zod `z.parse(process.env)` | Fail fast on missing env vars before any browser is launched |
| Logging | Pino | Structured JSON logs; `logger.child({ url })` for per-task context |
| Testing | Vitest + `jest-puppeteer` OR Vitest mocks | ESM-native; mock `page` with `vi.fn()` for unit tests |
| Module system | ESM (`"type": "module"`) | Modern; consistent with rest of TS stack |
| Session management | `BrowserContext` per task | Cookie/session isolation between parallel automations |

## Process

1. Read `reference/node-puppeteer-config.md` — `package.json`, `tsconfig.json`, `.env.example`, directory layout
2. Read `reference/node-puppeteer-patterns.md` — browser lifecycle, Page Object Model, waiting strategy, network interception
3. Read `reference/node-puppeteer-testing.md` — unit tests (mocked page), integration tests (real browser)
4. Define Zod schemas for scraped data shapes **before** writing selectors — they dictate what you extract
5. Implement Page Objects first — tests and tasks consume page objects, never raw selectors
6. Add `setRequestInterception` early for scraping tasks — blocking unused resources is cheapest at setup
7. Run `npm run typecheck && npm test` before finishing

## Common Commands

```bash
npm run dev          # Run automation script with tsx (Node.js 18+, no compile step)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output (dist/main.js)
npm test             # Run Vitest test suite
npm run typecheck    # tsc --noEmit (type-check without emitting)
npm run lint         # ESLint with @typescript-eslint
npm run screenshot   # Run screenshot task (example task script)
```

## Key Patterns

| Pattern | Implementation |
|---------|----------------|
| Browser singleton | `BrowserManager` class — launch once, expose `createContext()` |
| Session isolation | `browser.createBrowserContext()` per task; close in `finally` |
| Page Object | Class per page — typed methods, selectors as private constants |
| Waiting | `waitForSelector`, `waitForNavigation`, `waitForResponse` — never bare `setTimeout` |
| Scrape + validate | `page.evaluate()` → raw object → `z.parse(ScrapedSchema)` |
| Error screenshot | `page.screenshot()` in catch before rethrowing |
| Resource blocking | `page.setRequestInterception(true)` + abort `image/font/media` |
| Concurrency | `pLimit(3)` wrapping task function |
| Config | `z.object({ PUPPETEER_HEADLESS, CONCURRENCY, ... }).parse(process.env)` |
| Branded URL type | `type PageUrl = string & { readonly _brand: 'PageUrl' }` |

## Reference Files

| File | Content |
|------|---------|
| `reference/node-puppeteer-config.md` | `package.json`, `tsconfig.json`, directory layout, `.env.example`, `Dockerfile` |
| `reference/node-puppeteer-patterns.md` | `BrowserManager`, Page Object base, navigation, waiting, network interception, screenshot helpers |
| `reference/node-puppeteer-testing.md` | Unit tests (mocked `Page`), integration tests (real Chrome), Vitest config |
| `reference/node-puppeteer-review-checklist.md` | Review checklist for the `node-puppeteer` agent |

## Documentation Sources

Before generating code, verify against current docs:

| Source | Tool | What to check |
|--------|------|---------------|
| Puppeteer | Context7 MCP (`puppeteer/puppeteer`) | `Page`, `Browser`, `BrowserContext`, `Locator`, `waitFor*` APIs |
| Zod | Context7 MCP (`colinhacks/zod`) | Schema types, `safeParse`, `z.infer` |
| TypeScript | Context7 MCP (`microsoft/TypeScript`) | Strict mode flags, branded types, `satisfies` |
| Vitest | Context7 MCP (`vitest-dev/vitest`) | `vi.fn()`, `vi.mock()`, `describe`, `it`, `expect` |
| p-limit | Context7 MCP (`sindresorhus/p-limit`) | Concurrency limiting API |

## Error Handling

- **Navigation failure** (`TimeoutError`, non-2xx status): screenshot → log with URL + status → rethrow typed `NavigationError`
- **Element not found** (`waitForSelector` timeout): screenshot → log with selector + page URL → rethrow `SelectorError`
- **Validation failure** (Zod parse): log scraped raw data → throw `ScrapedDataError` with Zod issues
- **Concurrency errors**: each task isolated in its own context — one task crashing must not affect others
- **Never** use empty catch blocks — every catch logs + rethrows or returns a `Result.failure`
- **Never** use `page.waitForTimeout()` as a substitute for proper waiting — only use with explanatory comment
