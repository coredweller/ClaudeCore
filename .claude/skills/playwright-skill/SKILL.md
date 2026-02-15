---
name: playwright-skill
description: This skill should be used for browser automation tasks including website testing, UX validation, responsive design checks, or any Playwright-based automation.
allowed-tools: Bash, Read
---

# Playwright Browser Automation

General-purpose browser automation skill. Write custom Playwright code for any automation task and execute it via the universal executor.

For installation and path resolution details -> Read [reference/playwright-patterns.md](reference/playwright-patterns.md)

## Critical Workflow

Follow these steps in order for every automation task:

1. **Detect dev servers** - For localhost testing, ALWAYS run detection FIRST:
   ```bash
   cd $SKILL_DIR && node -e "require('./lib/helpers').detectDevServers().then(servers => console.log(JSON.stringify(servers)))"
   ```
   - 1 server found: use it automatically
   - Multiple servers: ask user which one
   - No servers: ask for URL or offer to help start dev server

2. **Write script to /tmp** - NEVER write to skill directory. Use `/tmp/playwright-test-*.js`

3. **Use visible browser** - Always `headless: false` unless user requests headless

4. **Parameterize URLs** - Put URL in a `TARGET_URL` constant at top of script

5. **Execute from skill directory**:
   ```bash
   cd $SKILL_DIR && node run.js /tmp/playwright-test-*.js
   ```

## Basic Execution Template

```javascript
// /tmp/playwright-test-page.js
const { chromium } = require('playwright');
const TARGET_URL = 'http://localhost:3001'; // Auto-detected or from user

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(TARGET_URL);
  console.log('Page loaded:', await page.title());
  await page.screenshot({ path: '/tmp/screenshot.png', fullPage: true });
  await browser.close();
})();
```

## Reference Files

- For automation code examples (responsive testing, login flows, forms, link checking, screenshots, inline execution, helpers, custom headers) -> Read [reference/playwright-patterns.md](reference/playwright-patterns.md)
- For Playwright API core (selectors, actions, waiting, assertions) -> Read [reference/playwright-api-core.md](reference/playwright-api-core.md)
- For advanced patterns (POM, network mocking, mobile, visual testing, CI/CD) -> Read [reference/playwright-api-advanced.md](reference/playwright-api-advanced.md)
- For setup, installation, path resolution, and troubleshooting -> Read [reference/playwright-patterns.md](reference/playwright-patterns.md)

## Tips

- **Detect servers FIRST** - Always run `detectDevServers()` before writing test code
- **Use /tmp for test files** - Write to `/tmp/playwright-test-*.js`, never to skill directory
- **Slow down** - Use `slowMo: 100` to make actions visible
- **Wait strategies** - Use `waitForURL`, `waitForSelector`, `waitForLoadState` instead of fixed timeouts
- **Error handling** - Always use try-catch for robust automation
- **Console output** - Use `console.log()` to track progress

## Example Interaction

```
User: "Test if the marketing page looks good"

Claude: I'll test the marketing page across multiple viewports. Let me first detect running servers...
[Runs: detectDevServers()]
[Output: Found server on port 3001]
I found your dev server running on http://localhost:3001

[Writes custom automation script to /tmp/playwright-test-marketing.js with URL parameterized]
[Runs: cd $SKILL_DIR && node run.js /tmp/playwright-test-marketing.js]
[Shows results with screenshots from /tmp/]
```

## Notes

- Each automation is custom-written for your specific request
- Not limited to pre-built scripts - any browser task possible
- Auto-detects running dev servers to eliminate hardcoded URLs
- Test scripts written to `/tmp` for automatic cleanup (no clutter)
- Code executes reliably with proper module resolution via `run.js`
- Progressive disclosure - reference files loaded only when needed

## Error Handling

**Element not found**: Use `waitForSelector` with explicit timeouts instead of fixed `page.waitForTimeout()`. Check selector specificity if elements are dynamically rendered.

**Navigation timeout**: Increase timeout for slow pages. Use `waitForLoadState('networkidle')` for SPAs that make async API calls after initial load.

**Flaky tests**: Add retry logic for network-dependent assertions. Use `expect(locator).toBeVisible()` with Playwright's auto-retry instead of manual checks.
