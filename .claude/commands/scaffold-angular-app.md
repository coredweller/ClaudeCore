---
description: Scaffold a new Angular 21.x SPA with standalone components, lazy routing, TailwindCSS + daisyUI, and a sample feature module
argument-hint: "[app name]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, mcp__context7__resolve-library-id, mcp__context7__query-docs
disable-model-invocation: true
---

# Scaffold Angular SPA

Create a new Angular 21.x SPA project with the following:

**App name:** $ARGUMENTS (default to "my-app" if not provided)

## Pre-requisites

1. Read the `angular-spa` skill (`SKILL.md` and `reference/angular-templates.md`) for project conventions, code templates, and best practices.
2. Fetch `https://angular.dev/assets/context/llms-full.txt` using WebFetch for the latest Angular API reference.
3. Use Context7 MCP (`resolve-library-id` then `query-docs`) to verify any APIs you are unsure about.
4. Cross-check `ng new` CLI flags against the fetched docs — do NOT pass removed/default flags (e.g., `--standalone`).

## Steps

1. **Scaffold the project** — `npx @angular/cli@latest new <name> --style=scss --ssr=false`. Verify flags against fetched docs.
2. **Install TailwindCSS 4.x + daisyUI** — `npm install tailwindcss @tailwindcss/postcss daisyui@latest`. Follow the `angular-spa` skill reference `tailwind-v4-config.md` for `.postcssrc.json` and `src/styles.css` setup.
3. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to Angular/TypeScript or general cross-cutting concerns like `code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`, and `code-reviewer`. Include the cross-cutting agents like `architect.md`, `css-expert.md`, `security-reviewer.md`, `accessibility-auditor.md`, `ui-standards-expert.md`, and `frontend-design.md`. Include the required skills folders as well such as `angular-spa` and `frontend-design`.
4. **Set up folder structure** — `core/services/`, `core/interceptors/`, `core/guards/`, `shared/components/`, `shared/pipes/`, `shared/directives/`, `features/dashboard/`.
5. **Configure `app.config.ts`** — Follow the `angular-spa` skill template. Do NOT add zone-related providers.
6. **Create a Dashboard feature** — Standalone component with OnPush, signals, inject(), control flow, daisyUI styling. Must render meaningful content without a backend. Follow component templates from the skill reference.
7. **Set up lazy-loaded routes** — Root redirects to dashboard, `loadComponent` for lazy loading, wildcard redirect.
8. **Create a sample service** — `inject(HttpClient)`, `providedIn: 'root'`, calls dashboard stats endpoint.
9. **Handle missing backend gracefully** — Show static/fallback data when API fails; page must never be blank.
10. **Add auth interceptor stub** — `HttpInterceptorFn` in `core/interceptors/`.
11. **Add auth guard stub** — `CanActivateFn` in `core/guards/`.
12. **Create environment config** — `src/environments/environment.ts` with `apiUrl`.
13. **Add a unit test** — Dashboard component test with zoneless TestBed setup. Follow test templates from the skill reference.
14. **Verify** — Run `npx ng build` to catch errors before finishing.
15. **Print summary** — List created files, how to run (`npm start`), and next steps.

## Reference

Follow the `angular-spa` skill templates and reference files for component patterns, best practices, and code templates:
- `reference/angular-templates.md` — Component, service, routes, config, interceptor, guard, and test templates
- `reference/angular-troubleshooting.md` — Common errors, CLI commands, best practices
- `reference/daisyui-v5-components.md` — daisyUI component reference, color system, themes
- `reference/tailwind-v4-config.md` — TailwindCSS 4.x setup and breaking changes from v3
- `reference/accessibility-checklist.md` — WCAG 2.1 AA checklist, ARIA patterns, test protocol
