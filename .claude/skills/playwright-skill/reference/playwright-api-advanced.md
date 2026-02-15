# Playwright API Reference - Advanced Patterns

For core API (selectors, actions, waiting, assertions), see `playwright-api-core.md`.

## Page Object Model (POM)

```javascript
class LoginPage {
  constructor(page) {
    this.page = page;
    this.usernameInput = page.locator('input[name="username"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.errorMessage = page.locator('.error-message');
  }

  async navigate() { await this.page.goto('/login'); }

  async login(username, password) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async getErrorMessage() { return await this.errorMessage.textContent(); }
}

// Usage in test
test('login with valid credentials', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.login('user@example.com', 'password123');
  await expect(page).toHaveURL('/dashboard');
});
```

## Network & API Testing

### Intercepting Requests

```javascript
// Mock API responses
await page.route('**/api/users', route => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }])
  });
});

// Modify requests
await page.route('**/api/**', route => {
  const headers = { ...route.request().headers(), 'X-Custom-Header': 'value' };
  route.continue({ headers });
});

// Block resources
await page.route('**/*.{png,jpg,jpeg,gif}', route => route.abort());
```

### Custom Headers via Environment Variables

```bash
# Single header
PW_HEADER_NAME=X-Automated-By PW_HEADER_VALUE=playwright-skill

# Multiple headers (JSON)
PW_EXTRA_HEADERS='{"X-Automated-By":"playwright-skill","X-Request-ID":"123"}'
```

Precedence: options.extraHTTPHeaders > env vars > defaults.

## Visual Testing

```javascript
// Full page screenshot
await page.screenshot({ path: 'screenshot.png', fullPage: true });

// Element screenshot
await page.locator('.chart').screenshot({ path: 'chart.png' });

// Visual comparison
await expect(page).toHaveScreenshot('homepage.png');
```

## Mobile Testing

```javascript
const { devices } = require('playwright');
const iPhone = devices['iPhone 12'];

const context = await browser.newContext({
  ...iPhone,
  locale: 'en-US',
  permissions: ['geolocation'],
  geolocation: { latitude: 37.7749, longitude: -122.4194 }
});
```

## Debugging

```bash
npx playwright test --debug      # Run with inspector
npx playwright test --headed     # Headed mode
npx playwright test --headed --slowmo=1000  # Slow motion
```

```javascript
await page.pause();  // Pause execution
page.on('console', msg => console.log('Browser log:', msg.text()));
page.on('pageerror', error => console.log('Page error:', error));
```

## Performance Testing

```javascript
const startTime = Date.now();
await page.goto('https://example.com');
const loadTime = Date.now() - startTime;
console.log(`Page loaded in ${loadTime}ms`);
```

## Parallel & Data-Driven Testing

```javascript
// Parallel execution
test.describe.parallel('Parallel suite', () => {
  test('test 1', async ({ page }) => { /* ... */ });
  test('test 2', async ({ page }) => { /* ... */ });
});

// Parameterized tests
const testData = [
  { username: 'user1', password: 'pass1', expected: 'Welcome user1' },
  { username: 'user2', password: 'pass2', expected: 'Welcome user2' },
];

testData.forEach(({ username, password, expected }) => {
  test(`login with ${username}`, async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await expect(page.locator('.message')).toHaveText(expected);
  });
});
```

## Accessibility Testing

```javascript
import { injectAxe, checkA11y } from 'axe-playwright';

test('accessibility check', async ({ page }) => {
  await page.goto('/');
  await injectAxe(page);
  await checkA11y(page);
});
```

## CI/CD Integration (GitHub Actions)

```yaml
name: Playwright Tests
on:
  push:
    branches: [main, master]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - name: Install dependencies
        run: npm ci
      - name: Install Playwright Browsers
        run: npx playwright install --with-deps
      - name: Run tests
        run: npx playwright test
```

## Common Patterns

### Handling Popups
```javascript
const [popup] = await Promise.all([
  page.waitForEvent('popup'),
  page.click('button.open-popup')
]);
await popup.waitForLoadState();
```

### File Downloads
```javascript
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('button.download')
]);
await download.saveAs(`./downloads/${download.suggestedFilename()}`);
```

### iFrames
```javascript
const frame = page.frameLocator('#my-iframe');
await frame.locator('button').click();
```

## Troubleshooting

1. **Element not found** - Check if element is in iframe, verify visibility
2. **Timeout errors** - Increase timeout, check network conditions
3. **Flaky tests** - Use proper waiting strategies, mock external dependencies
4. **Authentication issues** - Verify auth state is properly saved

## Quick Reference Commands

```bash
npx playwright test                        # Run tests
npx playwright test --headed               # Headed mode
npx playwright test --debug                # Debug tests
npx playwright codegen https://example.com # Generate code
npx playwright show-report                 # Show report
```
