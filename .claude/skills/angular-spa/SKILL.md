---
name: angular-spa
description: "Angular 21.x SPA development skill with TailwindCSS 4.x and daisyUI 5.5.5. Use when building Angular standalone components, services, lazy-loaded routes, unit tests, or creating UI with TailwindCSS + daisyUI. Covers component scaffolding, UI/UX design, accessibility audits, and design systems."
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, mcp__context7__resolve-library-id, mcp__context7__query-docs
---

# Angular 21.x SPA Development Skill

> **Tech Stack**: Angular 21+, TailwindCSS 4.x, daisyUI 5.5.5

## Conventions & Structure

> For code conventions, styling rules, design principles, key patterns, folder structure, and common commands, read `reference/angular-conventions.md`

## Documentation Sources

Before generating code, consult these sources for current syntax and APIs:

| Source | URL / Tool | Purpose |
|--------|-----------|---------|
| Angular v21 | `angular-cli` MCP (ng mcp) | Workspace-aware help, schematics, builds, best practices |
| Angular v21 | `https://angular.dev/assets/context/llms-full.txt` | Static docs bundle — API reference, deprecated features |
| daisyUI v5.5.5 | `https://daisyui.com/llms.txt` | Component reference, color system, themes |
| TailwindCSS / RxJS | `Context7` MCP | Latest syntax, utilities, operators |

Cross-check all Angular APIs and CLI flags against fetched docs — do NOT use deprecated or removed features.

> For Angular & TypeScript best practices, read reference/angular-best-practices.md

## Quick Scaffold — New Angular Project

```bash
npx @angular/cli@latest new my-app --style=scss --ssr=false
cd my-app
```

Do NOT pass `--standalone` (removed/default since v19). Verify flags against fetched docs.

## Process

1. **Understand Requirements** — Clarify feature scope, API endpoints, data models, and UI requirements
2. **Scaffold Structure** — Create feature folder under `src/app/features/<feature-name>/`
3. **Generate Component** — Read `reference/angular-templates.md` for templates; create with signals-based state
4. **Create Service** — Read `reference/angular-templates.md` for service template; implement API calls with HttpClient + RxJS
5. **Configure Routes** — Add lazy-loaded route using `loadComponent` in `app.routes.ts` or feature routes
6. **Write Tests** — Read `reference/angular-templates.md` for test templates; write unit tests with zoneless TestBed
7. **Style Component** — Use daisyUI components + TailwindCSS utilities; fallback to SCSS with BEM naming
8. **Verify Build** — Run `ng build` to ensure no compilation errors

## Reference Files

Detailed patterns are in `reference/`:

### Angular Best Practices & Code Templates
- `angular-best-practices.md` — TypeScript, component, template, state management, services, forms, zoneless, accessibility, and testing best practices
- `angular-templates.md` — Standalone component, service, lazy routes, app.config, interceptor, guard, and test templates
- `angular-troubleshooting.md` — Common errors (NG0908, NullInjectorError, blank screen), CLI commands, and best practices

### UI/UX & Design System
- `tailwind-v4-config.md` — TailwindCSS 4.x setup, breaking changes from v3
- `daisyui-v5-components.md` — Full component reference, color system, themes, quick setup patterns
- `angular-ui-form-components.md` — Form fields and validation components
- `angular-ui-data-components.md` — Cards, tables, skeletons, empty states, navigation
- `angular-ui-feedback-components.md` — Toasts, dialogs, themes, error handling, utilities
- `accessibility-checklist.md` — WCAG 2.1 AA checklist, ARIA patterns, test protocol
- `animations.md` — Timing standards, keyframes, utility classes
- `user-research.md` — Persona templates, journey mapping, usability testing, SUS survey

## Error Handling

**Build failures (`NG0908`, `NullInjectorError`)**: Read `reference/angular-troubleshooting.md` for common errors and fixes.

**TailwindCSS not applied**: Verify `.postcssrc.json` exists (not `postcss.config.js`) and global styles use `.css` (not `.scss`).

**Blank screen on load**: Check browser console for lazy-loading errors. Verify route paths and `loadComponent` imports.
