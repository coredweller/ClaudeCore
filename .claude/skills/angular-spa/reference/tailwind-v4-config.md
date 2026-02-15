# TailwindCSS v4.x Configuration

## CSS-Native Configuration (No tailwind.config.js)

TailwindCSS v4 is a complete rewrite using CSS-native configuration:

```css
/* src/styles.css (NOT .scss — TailwindCSS 4.x directives conflict with Sass) */
@import "tailwindcss";

@theme {
  /* Typography */
  --font-sans: "Inter", "system-ui", sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  /* Custom spacing */
  --spacing-18: 4.5rem;
  --spacing-22: 5.5rem;

  /* Custom breakpoints */
  --breakpoint-3xl: 1920px;

  /* Animation durations */
  --duration-instant: 50ms;
  --duration-quick: 150ms;
  --duration-standard: 250ms;
}

@plugin "daisyui" {
  themes: light --default, dark --prefersdark, corporate, business;
}
```
> **Note:** Do NOT add `@import "daisyui"` — daisyUI is loaded via the `@plugin` directive in TailwindCSS 4.x. The global stylesheet must be `.css` (not `.scss`) to avoid Sass intercepting CSS-native directives like `@import`, `@theme`, and `@plugin`.

## Breaking Changes from v3

| v3 Syntax | v4 Syntax | Notes |
|-----------|-----------|-------|
| `tailwind.config.js` | `@theme { }` in CSS | No JS config file |
| `@apply` directive | Still works, but discouraged | Use CSS variables instead |
| `theme.extend` | `@theme { --custom: value }` | CSS custom properties |
| `screens` config | `--breakpoint-*` variables | CSS-native breakpoints |
| `colors` config | Use daisyUI semantic colors | Don't define custom colors |

## PostCSS Configuration

> **CRITICAL:** Angular's `@angular/build:application` builder only reads `.postcssrc.json`. It **ignores** `postcss.config.js` / `.mjs` / `.cjs`. If you use the wrong file name, PostCSS plugins will not run and TailwindCSS utilities + daisyUI components will be missing from the output CSS.

```json
// .postcssrc.json (in project root, next to angular.json)
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

## Angular Integration

```json
// angular.json (styles array)
{
  "styles": [
    "src/styles.css"
  ]
}
```

## Breakpoints

```css
sm:   640px    /* Small tablets */
md:   768px    /* Tablets */
lg:   1024px   /* Small laptops */
xl:   1280px   /* Desktop */
2xl:  1536px   /* Large desktop */
```

Usage:
```html
<div class="p-4 md:p-6 lg:p-8">
  <!-- 16px mobile, 24px tablet, 32px desktop -->
</div>
```
