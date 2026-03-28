# Node.js Puppeteer — Review Checklist

Used by the `node-puppeteer` agent when reviewing pull requests or code changes.

---

## TypeScript & Type Safety

- [ ] `strict: true` and `noUncheckedIndexedAccess: true` enabled in `tsconfig.json`
- [ ] No `any` types — use `unknown` + type guards, or proper Puppeteer generics
- [ ] No `as unknown as X` casts without an explanatory comment
- [ ] All scraped data validated with Zod before use — never trust the DOM directly
- [ ] Page Object methods have explicit return types
- [ ] `ElementHandle` typed correctly (e.g. `ElementHandle<HTMLInputElement>`, not `ElementHandle<Element>`)

---

## Browser & Resource Management

- [ ] Browser launched once and reused — not launched per task or per test
- [ ] Each parallel task gets its own `BrowserContext` — not a shared context
- [ ] Every `Page` and `BrowserContext` closed in a `finally` block
- [ ] No unclosed pages or contexts (check with `browser.pages()` in tests if unsure)
- [ ] `shm_size: '2gb'` set in `docker-compose.yml` (Chrome requires shared memory in Docker)
- [ ] `--disable-dev-shm-usage` only used as a fallback when `shm_size` cannot be increased

---

## Waiting Strategy

- [ ] No bare `page.waitForTimeout()` — every sleep has a comment explaining why no event-based wait works
- [ ] `waitForSelector` uses `{ visible: true }` when the element must be interactable, not just present in DOM
- [ ] `waitForNavigation` called in `Promise.all` with the triggering action — not before or after
- [ ] Network waits use `waitForResponse` with a specific URL matcher, not a broad wildcard
- [ ] Timeouts sourced from `config.puppeteer.timeout` — no magic numbers inline

---

## Selector Quality

- [ ] Selectors prefer `data-testid` > ARIA role > CSS class > XPath
- [ ] No positional selectors (`nth-child`, `nth-of-type`) that break on layout changes
- [ ] All selectors extracted to named constants in the Page Object — no raw strings in test files
- [ ] XPath used only when CSS is insufficient (e.g. text content matching) — add a comment

---

## Error Handling

- [ ] Every `page.goto()` wrapped in try/catch with screenshot + rethrow
- [ ] Every `waitForSelector` failure saves a screenshot before rethrowing
- [ ] No empty catch blocks — every catch logs context and either rethrows or returns `Result.failure`
- [ ] `NavigationError` thrown (not a generic `Error`) when `response.ok()` is false
- [ ] Error screenshots include a descriptive label and timestamp in the filename
- [ ] Log includes: URL, selector, error type, current page URL at time of failure

---

## Page Object Design

- [ ] One class per page or major page section
- [ ] All selectors as private constants at the top of the file
- [ ] Public methods represent user actions (`open`, `search`, `clickSubmit`) — not DOM operations (`click('[data-testid="btn"]')`)
- [ ] `BasePage` used for shared navigation, screenshot, and wait helpers — no duplication
- [ ] Page Objects do not import from `test/` — clean dependency direction

---

## Concurrency

- [ ] `p-limit` used to cap parallel page launches — no `Promise.all` over unbounded arrays of page tasks
- [ ] `config.concurrency.maxPages` respected — no hardcoded concurrency numbers
- [ ] One task failing does not crash siblings — errors caught per-task, not at the `Promise.all` level

---

## Performance

- [ ] `setRequestInterception(true)` blocks `image/font/media` for scraping tasks where visuals not needed
- [ ] `page.evaluate()` used for bulk DOM extraction — not multiple sequential `page.$eval()` calls
- [ ] No redundant `page.reload()` calls — navigate once and wait properly
- [ ] Session reused via cookie restoration where login is required — not re-logging in per task

---

## Config & Security

- [ ] All env vars declared in `.env.example`
- [ ] Config validated with Zod at startup — app exits immediately on missing required vars
- [ ] No credentials, tokens, or cookies committed to source control
- [ ] `--no-sandbox` and `--disable-setuid-sandbox` only set in Docker/CI via config — not hardcoded for local dev
- [ ] `PUPPETEER_EXECUTABLE_PATH` used in Docker to point to system Chromium (not the bundled one)

---

## Testing

- [ ] Unit tests use mocked `Page` — no real browser in `test/unit/`
- [ ] Integration tests use `beforeAll`/`afterAll` for browser lifecycle — not `beforeEach` (expensive)
- [ ] Each integration test gets a fresh `BrowserContext` and `Page` in `beforeEach`/`afterEach`
- [ ] Integration test timeout set to ≥ 30s in Vitest config
- [ ] `poolOptions.forks.singleFork: true` set for integration tests — Chrome is not thread-safe across forks
- [ ] Zod schema validation tested independently (unit) with accept/reject cases

---

## Pre-Merge Gate

```bash
npm run typecheck   # Zero TypeScript errors
npm run lint        # Zero ESLint errors
npm run test:unit   # All unit tests pass (fast, no browser)
npm run test:integration  # All integration tests pass (slower, real Chrome)
```
