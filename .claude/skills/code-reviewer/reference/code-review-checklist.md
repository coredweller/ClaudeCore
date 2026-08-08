# Code Review Checklist

## Output Contract

This is the exact shape every review produces — deterministic and machine-checkable. Don't freelance the structure; don't re-derive a severity that's already tagged on the checklist item below.

### Legend

| Symbol | Meaning | Verdict weight |
|---|---|---|
| 🔴 | Ships a bug, vulnerability, or data-loss path — blocks the PR | Blocker |
| 🟡 | A real defect that degrades correctness, performance, or maintainability without directly breaking or exposing anything | Warning |
| 🔵 | Suggestion — consider improving | Non-gating |
| ❌ | Current/bad code in a Fix snippet | — |
| ✅ | Corrected/good code in a Fix snippet | — |

### Header (fixed block, always first)

```
Scope: <local branch | PR #<n>>
Date: <YYYY-MM-DD>
Branch: <branch-name>
Ticket: <TICKET-ID | none>
Verdict: <✅ PASS | ⚠️ PASS WITH WARNINGS | ❌ FAIL>
```

`Date` is captured in Phase 1, never written from memory: `git log -1 --date=short --format=%cd` locally, or the PR's `updatedAt` in PR mode. It's the date the code under review last changed. You don't know today's date; the repo does.

### Summary (one line, fixed order, no other text)

```
Summary: 🔴 <count> 🟡 <count> 🔵 <count>
```

### Findings

One block per finding, 🔴 findings first, then 🟡, then 🔵:

```
🔴 Rule: security/hardcoded-credentials
File: src/api/client.ts:42
Issue: API key exposed in source code
Fix: Move to environment variable
❌ const apiKey = "sk-abc123";
✅ const apiKey = process.env.API_KEY;
```

- `Rule:` is `<section>/<slug>` — the section heading lowercased with spaces hyphenated, plus the bolded slug on the line that fired. `## Error Handling` + **silent-failure** → `error-handling/silent-failure`.
- **One defect, one finding.** When two rules describe the same code, report only the more specific one — a 60-line handler is `architecture/logic-in-handler`, not that *and* `code-quality/large-function`. Double-reporting inflates the Summary counts that decide the verdict.
- **If a genuine defect fits no line below, report it as `other/<your-slug>`** and set the severity yourself from the Legend. This is the escape hatch for real problems the checklist hasn't caught up to — not a licence to invent rules, and not a place to park a hunch. **At most two `other/` findings per review**: if you have more, the checklist is the problem rather than the diff, so report the two most serious and say so under Recommendations.
- Leading emoji = severity — copy it from the checklist line that fired, never re-judge it.
- `File:` is always `<path>:<line>` — a single line, even for a multi-line issue (point at the line the fix touches).
- `❌`/`✅` snippet lines are optional — include only when a short before/after clarifies the fix; omit for findings with no meaningful snippet (e.g. missing tests).

### Recommendations (closing section, always last)

1–5 bullets of the highest-leverage next steps, independent of individual findings (e.g. "add integration tests before merging," "run `npm audit fix`"). Omit the section if there's nothing beyond the findings themselves.

## Verdict Criteria

| Findings | Verdict |
|---|---|
| Any 🔴 | ❌ **FAIL** |
| No 🔴, at least one 🟡 | ⚠️ **PASS WITH WARNINGS** |
| No 🔴 or 🟡 (🔵 only, or none) | ✅ **PASS** |

🔵 findings are always reported but never change the verdict.

## What Belongs on This Checklist

Every rule below is answerable from the diff itself, or from one targeted read. If confirming a rule would take a tool call Phase 3 doesn't have — running a test suite, querying a CVE database, measuring a bundle — it doesn't belong here, because a reviewer that can't observe the answer will either invent one or quietly skip the rule. Both are worse than the rule not existing. Route those checks to CI or to a specialist agent instead.

## Security

- 🔴 **hardcoded-credentials** — API keys, passwords, or tokens in source
- 🔴 **sql-injection** — string concatenation or interpolation into a query
- 🔴 **command-injection** — user-controlled data reaching `exec`/`spawn`/a shell string. Trace the value to its source; the defect is rarely visible on the line that calls `exec`.
- 🔴 **xss** — unescaped user input rendered into markup
- 🔴 **missing-input-validation** — external input used without validation. If the code asserts a type instead of validating it, report `type-safety/unchecked-cast` — same defect, more specific rule.
- 🔴 **broken-authorization** — the code checks *who you are* but not *what you own*. An authenticated request reaching another user's record by ID is IDOR; a reversed or absent ownership comparison reads as perfectly normal code, so confirm the check exists **and** that it points the right way.
- 🔴 **path-traversal** — user-controlled file paths
- 🔴 **csrf** — state-changing request with no CSRF protection
- 🔴 **auth-bypass** — a route that skips the auth middleware/guard
- 🟡 **new-dependency** — the diff adds or bumps a package in a manifest (`package.json`, `go.mod`, `pom.xml`, `*.csproj`). Flag it for an audit pass; do not assert whether a CVE exists, you have no way to check.

> For deep security analysis (OWASP Top 10, secrets detection, dependency CVEs, financial transaction security), delegate to the `security-reviewer` agent.

## Architecture

- 🔴 **logic-in-handler** — business logic in a handler/controller method; flag any handler method over 50 lines
- 🔴 **framework-types-in-service** — `req`/`res` or other framework request/response/context objects passed into or used inside a service
- 🔴 **rules-in-repository** — decision logic in a repository; repositories are persistence/query only
- 🔴 **upward-import** — dependencies flow one direction only, handler → service → repository; a repository importing a service, or a service importing a handler, is a violation
- 🔴 **repository-owns-connection** — a repository fetching its own connection/transaction handle instead of accepting one as a parameter. A service wrapping two such calls in one transaction cannot guarantee both run inside it, so a failure partway through leaves partial writes with nothing to roll back.

## Error Handling

- 🔴 **silent-failure** — a `catch` that returns `[]`, `null`, `0`, fabricated data, or any other substitute value instead of letting the failure surface. Adding a `catch` is not error handling: it must rethrow or return an explicit error state.
  ```
  ❌ catch (e) { return 0; }
  ✅ catch (e) { logger.error({ err: e }, 'stock lookup failed'); throw e; }
  ```
- 🔴 **unlogged-catch** — a `catch` that doesn't log the error with context, empty blocks included. Disjoint from silent-failure: a catch can rethrow correctly and still log nothing, and each is a violation on its own.

## Type Safety

- 🔴 **unchecked-cast** — asserting a type onto untrusted input (`req.body as StripeEvent`, an unchecked cast, a raw `Object`) instead of parsing it. A cast claims a fact the compiler never verified; on external input that claim *is* the vulnerability.
- 🟡 **untyped-boundary-leak** — `any` / `interface{}` / raw maps held past the deserialization boundary
- 🟡 **non-exhaustive-switch** — a switch/match over a closed union or enum that falls through a silent `default`

## Concurrency

- 🔴 **race-condition** — concurrent paths touching shared state with no ordering guarantee: check-then-act on a shared record without a lock or atomic operation, an unawaited promise whose result is read later, a counter or cache mutated from parallel handlers. Ask what else can run between the read and the write.

## Lifecycle

- 🟡 **missing-init-guard** — `initX()` with no double-init guard; a second call silently replaces the handle and leaks the first
- 🟡 **unsafe-accessor** — `getX()` returning a non-null assertion instead of throwing a named error ("DB not initialized — call initDb() first") when uninitialized

## Code Quality

- 🔴 **deprecated-api** — the diff calls a symbol the codebase itself marks deprecated (`@deprecated` JSDoc, `[Obsolete]`, `@Deprecated`, a deprecation note on the definition). Confirm by reading the definition — that's a legitimate Phase 2 targeted question. Deprecation you could only confirm against external docs is out of scope for a finding: note it under Recommendations instead of asserting it from memory.
- 🟡 **large-function** — over 50 lines in a non-handler function; a long handler is `architecture/logic-in-handler` instead
- 🟡 **deep-nesting** — more than 4 levels
- 🟡 **duplicated-logic** — logic that already exists in a shared utility; check before adding
- 🔵 **large-file** — 750 to 1000 lines
- 🟡 **oversized-file** — over 1000 lines

## Logging

- 🔴 **sensitive-data** — passwords, tokens, keys, or PII in a log call, including whole request/user/payment objects logged wholesale
- 🔴 **console-call** — `console.*` anywhere (`console.log`, `console.error`, etc.); use the centralized logger
- 🔴 **wrong-error-key** — an error logged under any key other than `err` (e.g. `{ error: e }`, `{ exception: e }`). Pino's serializer only runs on the `err` key; any other key silently drops the stack trace.
  ```
  ❌ logger.error({ error: e }, 'payment failed');
  ✅ logger.error({ err: e }, 'payment failed');
  ```
- 🟡 **interpolated-log-message** — string interpolation in a log message breaks DataDog aggregation, which groups on the literal message string.
  ```
  ❌ logger.info(`User ${userId} logged in`);
  ✅ logger.info({ userId }, 'User logged in');
  ```

## HTTP Status

| Operation | Expected status |
|---|---|
| Create | `201 Created` |
| Delete | `204 No Content` |
| Async/queued operation | `202 Accepted` |
| Semantic/validation failure | `422 Unprocessable Entity` (not `400 Bad Request`) |

- 🟡 **wrong-status-code** — response status doesn't match the table for the operation being performed

## Testing

- 🔴 **test-only** — `.only` on a test or suite (`it.only`, `describe.only`, `test.only`); silently skips the rest of the suite in CI without failing the build
- 🟡 **shared-test-state** — module-level variables or fixtures mutated in place; causes order-dependent flakiness
- 🔴 **missing-tests** — new logic with no test; exempt docs-only or config-only diffs (no behavior change)

## Linting

- 🟡 **unexplained-suppression** — `eslint-disable` or equivalent without a comment explaining why

## Performance

- 🟡 **quadratic-algorithm** — O(n²) where O(n log n) is available
- 🟡 **unnecessary-rerenders** — change-detection or reactivity waste (a component without OnPush, an unbatched signal write, an unstable prop identity)
- 🔵 **unjustified-memoization** — memoization added with no measurement or comment justifying it. Correctness first; a memo that isn't answering a measured problem is indirection plus a stale-dependency risk.
- 🟡 **missing-caching**
- 🟡 **n-plus-one** — a query issued inside a loop over a result set

## Best Practices

- 🔵 **untracked-todo** — TODO/FIXME without a ticket
- 🔵 **missing-jsdoc** — public API without docs
- 🔵 **accessibility** — missing ARIA labels, poor contrast
- 🔵 **poor-naming** — `x`, `tmp`, `data`
- 🔵 **magic-number** — unexplained literal

## API Spec

Only evaluate this section when the diff touches a spec file (OpenAPI/Swagger YAML or JSON, `.proto`, or similar). Skip it entirely otherwise — don't hold a non-spec diff to these rules.

- 🟡 **field-case** — field names not `snake_case`
- 🟡 **id-convention** — object identifiers not named `{object}_id` and typed as `string`
- 🟡 **error-body-shape** — error response missing `success` / `message` / `reason_code`
- 🟡 **non-cursor-pagination** — pagination isn't cursor-based
- 🟡 **path-pattern** — path doesn't follow the established pattern
- 🟡 **missing-version-segment** — path missing a version segment (e.g. `/v1/...`)
