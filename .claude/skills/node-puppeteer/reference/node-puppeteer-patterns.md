# Node.js Puppeteer — Patterns Reference

## Browser Manager (singleton)

```typescript
// src/browser/browser-manager.ts
import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer';
import { config } from '../config.js';
import { logger } from '../logger.js';

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private browser: Browser | null = null;

  private constructor() {}

  static getInstance(): BrowserManager {
    BrowserManager.instance ??= new BrowserManager();
    return BrowserManager.instance;
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      logger.info('Launching browser');
      this.browser = await puppeteer.launch({
        headless: config.puppeteer.headless,
        slowMo: config.puppeteer.slowMo,
        defaultViewport: config.puppeteer.viewport,
        args: [
          '--no-sandbox',           // Required in Docker/CI
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // Prevents OOM in Docker (use shm_size: 2gb in compose instead)
          '--disable-gpu',
        ],
      });
      this.browser.on('disconnected', () => {
        logger.warn('Browser disconnected unexpectedly');
        this.browser = null;
      });
    }
    return this.browser;
  }

  async createContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    return browser.createBrowserContext();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed');
    }
  }
}
```

---

## Branded Types

```typescript
// src/browser/types.ts
export type PageUrl = string & { readonly _brand: 'PageUrl' };
export type Selector = string & { readonly _brand: 'Selector' };

export function toPageUrl(url: string): PageUrl {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(`Invalid URL: ${url}`);
  }
  return url as PageUrl;
}

export function toSelector(sel: string): Selector {
  return sel as Selector;
}
```

---

## Base Page Object

```typescript
// src/pages/base-page.ts
import { Page, HTTPResponse } from 'puppeteer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { PageUrl } from '../browser/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class BasePage {
  protected readonly log: ReturnType<typeof logger.child>;

  constructor(protected readonly page: Page, logContext: Record<string, unknown> = {}) {
    this.log = logger.child(logContext);
  }

  protected async navigate(url: PageUrl, waitUntil: 'networkidle2' | 'load' | 'domcontentloaded' = 'networkidle2'): Promise<void> {
    this.log.info({ url }, 'Navigating');
    let response: HTTPResponse | null;
    try {
      response = await this.page.goto(url, {
        waitUntil,
        timeout: config.puppeteer.timeout,
      });
    } catch (err) {
      await this.screenshotOnError('navigation-failed');
      this.log.error({ url, err }, 'Navigation error');
      throw err;
    }

    if (!response?.ok()) {
      await this.screenshotOnError('navigation-non-2xx');
      const status = response?.status() ?? 0;
      this.log.error({ url, status }, 'Navigation returned non-2xx');
      throw new NavigationError(url, status);
    }
  }

  protected async waitForVisible(selector: string, timeout?: number): Promise<void> {
    try {
      await this.page.waitForSelector(selector, {
        visible: true,
        timeout: timeout ?? config.puppeteer.timeout,
      });
    } catch (err) {
      await this.screenshotOnError(`wait-failed-${selector.replace(/[^a-z0-9]/gi, '_')}`);
      this.log.error({ selector, err }, 'waitForSelector timed out');
      throw err;
    }
  }

  protected async screenshotOnError(label: string): Promise<void> {
    try {
      await fs.mkdir(config.output.screenshotDir, { recursive: true });
      const filename = path.join(config.output.screenshotDir, `${label}-${Date.now()}.png`);
      await this.page.screenshot({ path: filename, fullPage: true });
      this.log.info({ filename }, 'Error screenshot saved');
    } catch (screenshotErr) {
      this.log.warn({ screenshotErr }, 'Failed to save error screenshot');
    }
  }

  async screenshot(label: string): Promise<string> {
    await fs.mkdir(config.output.screenshotDir, { recursive: true });
    const filename = path.join(config.output.screenshotDir, `${label}-${Date.now()}.png`);
    await this.page.screenshot({ path: filename, fullPage: true });
    this.log.info({ filename }, 'Screenshot saved');
    return filename;
  }

  async pdf(label: string): Promise<string> {
    await fs.mkdir(config.output.screenshotDir, { recursive: true });
    const filename = path.join(config.output.screenshotDir, `${label}-${Date.now()}.pdf`);
    await this.page.pdf({ path: filename, format: 'A4', printBackground: true });
    this.log.info({ filename }, 'PDF saved');
    return filename;
  }
}

export class NavigationError extends Error {
  constructor(public readonly url: string, public readonly status: number) {
    super(`Navigation to ${url} failed with status ${status}`);
    this.name = 'NavigationError';
  }
}
```

---

## Concrete Page Object Example

```typescript
// src/pages/search-page.ts
import { Page } from 'puppeteer';
import { BasePage } from './base-page.js';
import { toPageUrl } from '../browser/types.js';
import { z } from 'zod';

const SELECTORS = {
  searchInput: '[data-testid="search-input"]',
  searchButton: '[data-testid="search-submit"]',
  resultItem: '[data-testid="result-item"]',
  resultTitle: '[data-testid="result-title"]',
  resultUrl: '[data-testid="result-url"]',
} as const;

const SearchResultSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

export class SearchPage extends BasePage {
  private static readonly BASE_URL = toPageUrl('https://example.com/search');

  constructor(page: Page) {
    super(page, { page: 'SearchPage' });
  }

  async open(): Promise<void> {
    await this.navigate(SearchPage.BASE_URL);
    await this.waitForVisible(SELECTORS.searchInput);
  }

  async search(query: string): Promise<void> {
    this.log.info({ query }, 'Searching');
    await this.page.type(SELECTORS.searchInput, query);
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
      this.page.click(SELECTORS.searchButton),
    ]);
    await this.waitForVisible(SELECTORS.resultItem);
  }

  async getResults(): Promise<SearchResult[]> {
    const rawResults = await this.page.evaluate((selectors) => {
      return Array.from(document.querySelectorAll(selectors.resultItem)).map(el => ({
        title: el.querySelector(selectors.resultTitle)?.textContent?.trim() ?? '',
        url: el.querySelector(selectors.resultUrl)?.getAttribute('href') ?? '',
      }));
    }, SELECTORS);

    // Validate scraped data at the boundary
    return rawResults.map((raw, i) => {
      const result = SearchResultSchema.safeParse(raw);
      if (!result.success) {
        this.log.warn({ raw, index: i, issues: result.error.issues }, 'Scraped result failed validation — skipping');
        return null;
      }
      return result.data;
    }).filter((r): r is SearchResult => r !== null);
  }
}
```

---

## Network Interception (resource blocking)

```typescript
// Block images, fonts, and media for scraping tasks where visuals are not needed
async function blockUnnecessaryResources(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
      request.abort();
    } else {
      request.continue();
    }
  });
}
```

---

## Network Interception (wait for API response)

```typescript
// Wait for a specific API call to complete after a user action
async function clickAndWaitForApi(page: Page, selector: string, apiUrlFragment: string): Promise<unknown> {
  const [response] = await Promise.all([
    page.waitForResponse(
      res => res.url().includes(apiUrlFragment) && res.status() === 200,
      { timeout: 30_000 }
    ),
    page.click(selector),
  ]);
  return response.json();
}
```

---

## Concurrency with p-limit

```typescript
// src/tasks/concurrent-scrape.task.ts
import pLimit from 'p-limit';
import { BrowserManager } from '../browser/browser-manager.js';
import { SearchPage } from '../pages/search-page.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export async function scrapeMultiple(queries: string[]): Promise<void> {
  const manager = BrowserManager.getInstance();
  const limit = pLimit(config.concurrency.maxPages);

  const tasks = queries.map(query =>
    limit(async () => {
      const context = await manager.createContext();
      const page = await context.newPage();
      try {
        const searchPage = new SearchPage(page);
        await searchPage.open();
        await searchPage.search(query);
        const results = await searchPage.getResults();
        logger.info({ query, count: results.length }, 'Scrape complete');
        return results;
      } finally {
        await page.close();
        await context.close();
      }
    })
  );

  await Promise.all(tasks);
}
```

---

## Authentication / Session Reuse

```typescript
// Save cookies after login
async function saveSession(page: Page, sessionFile: string): Promise<void> {
  const cookies = await page.cookies();
  await fs.writeFile(sessionFile, JSON.stringify(cookies, null, 2));
}

// Restore cookies before navigating to authenticated pages
async function restoreSession(page: Page, sessionFile: string): Promise<void> {
  const raw = await fs.readFile(sessionFile, 'utf-8');
  const cookies = JSON.parse(raw) as Parameters<Page['setCookie']>;
  await page.setCookie(...cookies);
}
```

---

## `src/main.ts` — Entry Point

```typescript
import 'dotenv/config';
import { BrowserManager } from './browser/browser-manager.js';
import { scrapeMultiple } from './tasks/concurrent-scrape.task.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const manager = BrowserManager.getInstance();
  try {
    await scrapeMultiple(['typescript puppeteer', 'node.js automation', 'web scraping']);
  } finally {
    await manager.close();
  }
}

main().catch(err => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
```
