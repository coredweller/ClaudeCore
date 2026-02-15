# Playwright API Reference - Core

For quick-start execution patterns, see SKILL.md. For advanced patterns, see `playwright-api-advanced.md`.

## Installation & Setup

### Prerequisites

```bash
# Check if Playwright is installed
npm list playwright 2>/dev/null || echo "Playwright not installed"

# Install (if needed)
cd ~/.claude/skills/playwright-skill
npm run setup
```

### Basic Configuration

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

## Core Patterns

### Basic Browser Automation

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  const page = await context.newPage();
  await page.goto('https://example.com', {
    waitUntil: 'networkidle'
  });

  await browser.close();
})();
```

### Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should do something', async ({ page }) => {
    const button = page.locator('button[data-testid="submit"]');
    await button.click();
    await expect(page).toHaveURL('/success');
    await expect(page.locator('.message')).toHaveText('Success!');
  });
});
```

## Selectors & Locators

### Best Practices for Selectors

```javascript
// PREFERRED: Data attributes (most stable)
await page.locator('[data-testid="submit-button"]').click();

// GOOD: Role-based selectors (accessible)
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');

// GOOD: Text content (for unique text)
await page.getByText('Sign in').click();

// OK: Semantic HTML
await page.locator('button[type="submit"]').click();

// AVOID: Classes and IDs (can change frequently)
await page.locator('.btn-primary').click();  // Avoid
```

### Advanced Locator Patterns

```javascript
// Filter and chain locators
const row = page.locator('tr').filter({ hasText: 'John Doe' });
await row.locator('button').click();

// Nth element
await page.locator('button').nth(2).click();

// Combining conditions
await page.locator('button').and(page.locator('[disabled]')).count();
```

## Common Actions

### Form Interactions

```javascript
await page.getByLabel('Email').fill('user@example.com');
await page.getByPlaceholder('Enter your name').fill('John Doe');
await page.locator('#username').clear();
await page.locator('#username').type('newuser', { delay: 100 });
await page.getByLabel('I agree').check();
await page.selectOption('select#country', 'usa');
await page.setInputFiles('input[type="file"]', 'path/to/file.pdf');
```

### Mouse & Keyboard Actions

```javascript
await page.click('button');
await page.dblclick('button');
await page.hover('.menu-item');
await page.dragAndDrop('#source', '#target');
await page.keyboard.type('Hello World', { delay: 100 });
await page.keyboard.press('Control+A');
await page.keyboard.press('Enter');
```

## Waiting Strategies

```javascript
// Wait for element states
await page.locator('button').waitFor({ state: 'visible' });
await page.locator('.spinner').waitFor({ state: 'hidden' });

// Wait for URL
await page.waitForURL('**/success');

// Wait for network
await page.waitForLoadState('networkidle');

// Wait for response
const responsePromise = page.waitForResponse('**/api/users');
await page.click('button#load-users');
const response = await responsePromise;

// Custom timeout
await page.locator('.slow-element').waitFor({
  state: 'visible',
  timeout: 10000
});
```

## Assertions

```javascript
import { expect } from '@playwright/test';

// Page assertions
await expect(page).toHaveTitle('My App');
await expect(page).toHaveURL('https://example.com/dashboard');

// Element visibility
await expect(page.locator('.message')).toBeVisible();
await expect(page.locator('button')).toBeEnabled();

// Text content
await expect(page.locator('h1')).toHaveText('Welcome');
await expect(page.locator('.message')).toContainText('success');

// Input values
await expect(page.locator('input')).toHaveValue('test@example.com');

// Attributes and CSS
await expect(page.locator('button')).toHaveAttribute('type', 'submit');
await expect(page.locator('.error')).toHaveCSS('color', 'rgb(255, 0, 0)');

// Count
await expect(page.locator('.item')).toHaveCount(5);
```
