# Node.js Puppeteer — Testing Reference

## Testing Strategy

| Test type | When to use | Tool | Browser |
|-----------|------------|------|---------|
| Unit | Page object logic, data transformation, Zod validation | Vitest + `vi.mock` | None — mock `Page` |
| Integration | Full navigation flow, real DOM interaction | Vitest + real Puppeteer | Headless Chrome |
| Visual | Screenshot regression | Vitest + `pixelmatch` or manual review | Headless Chrome |

**Run unit tests on every change.** Integration tests are slower (~2–10s per test) — run in CI and before PR.

---

## Unit Tests — Mocking the Page

Mock `Page` to test page object logic without launching a browser.

```typescript
// test/unit/search-page.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'puppeteer';

// Create a typed partial mock of Puppeteer's Page
function createMockPage(overrides: Partial<Page> = {}): Page {
  return {
    goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    waitForSelector: vi.fn().mockResolvedValue(null),
    type: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    waitForNavigation: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockResolvedValue([
      { title: 'TypeScript Guide', url: 'https://example.com/ts' },
      { title: 'Node.js Docs', url: 'https://example.com/node' },
    ]),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    cookies: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as Page;
}

describe('SearchPage', () => {
  let mockPage: Page;

  beforeEach(() => {
    mockPage = createMockPage();
  });

  it('navigates to the base URL on open()', async () => {
    const { SearchPage } = await import('../../src/pages/search-page.js');
    const searchPage = new SearchPage(mockPage);
    await searchPage.open();

    expect(mockPage.goto).toHaveBeenCalledWith(
      'https://example.com/search',
      expect.objectContaining({ waitUntil: 'networkidle2' })
    );
  });

  it('types query and waits for navigation on search()', async () => {
    const { SearchPage } = await import('../../src/pages/search-page.js');
    const searchPage = new SearchPage(mockPage);
    await searchPage.open();
    await searchPage.search('puppeteer typescript');

    expect(mockPage.type).toHaveBeenCalledWith(
      '[data-testid="search-input"]',
      'puppeteer typescript'
    );
    expect(mockPage.waitForNavigation).toHaveBeenCalled();
  });

  it('returns validated search results', async () => {
    const { SearchPage } = await import('../../src/pages/search-page.js');
    const searchPage = new SearchPage(mockPage);
    await searchPage.open();
    await searchPage.search('typescript');
    const results = await searchPage.getResults();

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'TypeScript Guide',
      url: 'https://example.com/ts',
    });
  });

  it('filters out results that fail Zod validation', async () => {
    vi.mocked(mockPage.evaluate).mockResolvedValueOnce([
      { title: 'Valid Result', url: 'https://example.com/valid' },
      { title: '', url: 'not-a-url' },  // should be filtered
    ]);

    const { SearchPage } = await import('../../src/pages/search-page.js');
    const searchPage = new SearchPage(mockPage);
    await searchPage.open();
    await searchPage.search('test');
    const results = await searchPage.getResults();

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Valid Result');
  });

  it('saves screenshot and rethrows on navigation error', async () => {
    const timeoutError = new Error('Navigation timeout');
    vi.mocked(mockPage.goto).mockRejectedValueOnce(timeoutError);

    const { SearchPage } = await import('../../src/pages/search-page.js');
    const searchPage = new SearchPage(mockPage);

    await expect(searchPage.open()).rejects.toThrow('Navigation timeout');
    expect(mockPage.screenshot).toHaveBeenCalled();
  });
});
```

---

## Unit Tests — Zod Schema Validation

Test that schemas correctly accept and reject shapes from the DOM.

```typescript
// test/unit/schemas.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const SearchResultSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
});

describe('SearchResultSchema', () => {
  it('accepts valid results', () => {
    const result = SearchResultSchema.safeParse({
      title: 'Example',
      url: 'https://example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = SearchResultSchema.safeParse({
      title: '',
      url: 'https://example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-URL', () => {
    const result = SearchResultSchema.safeParse({
      title: 'Test',
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});
```

---

## Unit Tests — Concurrency Logic

```typescript
// test/unit/concurrent-scrape.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/browser/browser-manager.js', () => ({
  BrowserManager: {
    getInstance: vi.fn().mockReturnValue({
      createContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue({ ok: () => true }),
          waitForSelector: vi.fn().mockResolvedValue(null),
          type: vi.fn().mockResolvedValue(undefined),
          click: vi.fn().mockResolvedValue(undefined),
          waitForNavigation: vi.fn().mockResolvedValue(null),
          evaluate: vi.fn().mockResolvedValue([]),
          screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
          close: vi.fn().mockResolvedValue(undefined),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

describe('scrapeMultiple', () => {
  it('runs without throwing for valid queries', async () => {
    const { scrapeMultiple } = await import('../../src/tasks/concurrent-scrape.task.js');
    await expect(scrapeMultiple(['query1', 'query2'])).resolves.not.toThrow();
  });
});
```

---

## Integration Tests — Real Browser

Integration tests use a real headless Chrome. They are slower and must be run sequentially.

```typescript
// test/integration/search-page.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Browser, BrowserContext, Page } from 'puppeteer';
import puppeteer from 'puppeteer';

// These tests hit a local test server or a live URL — set TEST_BASE_URL in .env.test
const BASE_URL = process.env['TEST_BASE_URL'] ?? 'https://example.com';

describe('SearchPage integration', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    // Each test gets a fresh context — no shared cookies/session
    context = await browser.createBrowserContext();
    page = await context.newPage();
  });

  afterEach(async () => {
    await page.close();
    await context.close();
  });

  it('loads the search page without errors', async () => {
    const response = await page.goto(`${BASE_URL}/search`, { waitUntil: 'networkidle2' });
    expect(response?.status()).toBe(200);
    await page.waitForSelector('[data-testid="search-input"]', { visible: true });
  });

  it('displays results after a search', async () => {
    await page.goto(`${BASE_URL}/search`, { waitUntil: 'networkidle2' });
    await page.type('[data-testid="search-input"]', 'typescript');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('[data-testid="search-submit"]'),
    ]);

    const results = await page.$$('[data-testid="result-item"]');
    expect(results.length).toBeGreaterThan(0);
  });

  it('captures a full-page screenshot', async () => {
    await page.goto(`${BASE_URL}/search`, { waitUntil: 'networkidle2' });
    const screenshot = await page.screenshot({ fullPage: true });
    // Just verify it returned a non-empty buffer
    expect(screenshot).toBeInstanceOf(Buffer);
    expect((screenshot as Buffer).length).toBeGreaterThan(0);
  });
});
```

---

## Vitest Config for Integration Tests

Run unit and integration tests in separate passes:

```bash
# Unit only (fast — no browser)
vitest run test/unit

# Integration only (slower — real browser)
vitest run test/integration

# All
vitest run
```

Or use separate configs:

```typescript
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,      // Browser tests need longer timeouts
    hookTimeout: 15_000,
    poolOptions: {
      forks: { singleFork: true },  // Sequential — Chrome is resource-heavy
    },
  },
});
```

Add to `package.json`:

```json
"test:unit": "vitest run test/unit",
"test:integration": "vitest run --config vitest.integration.config.ts"
```
