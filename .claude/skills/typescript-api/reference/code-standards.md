# Code Standards

> **Portable template.** In this repo these standards are already auto-loaded from
> `.claude/rules/code-standards.md` — do not read this file here, it is the same content.
> It ships inside the skill so the skill can be dropped into a repo that has no rules
> directory of its own. Keep it in sync with the rules file when either changes.

## Modify Existing Files First

```
Need to add code?
    ↓
Does relevant file exist?
    ├─ YES → Modify existing file (DEFAULT)
    └─ NO → Is this >150–200 lines of cohesive new logic?
              ├─ YES → Consider new file (ask human first)
              └─ NO → Find closest existing file and add there
```

When creating new files: remove/update old files, update all imports, delete orphans. NEVER leave old + new both existing.

## Error Handling

### No Silent Failures, No Mock Data, No Fallbacks

```
// ❌ FORBIDDEN (applies to ALL languages)
catch (e) { return []; }           // Silent empty return
catch (e) { return MockData.x; }   // Fake data
catch (e) { /* nothing */ }        // Swallowed exception

// ✅ REQUIRED
catch (e) {
  logger.error('fetchData failed', error: e);
  rethrow; // OR return error state (Result.failure, HttpException, HTTPException, etc.)
}
```

- Every catch block MUST log the error
- Every catch block MUST either rethrow OR return an error state
- User MUST see when something fails (snackbar, error widget, toast, etc.)
- NEVER return empty list/null/default on error
- NEVER create mock data unless explicitly requested
- Language-specific patterns: see each technology's skill (for TypeScript, `reference/service-errors.md`)

## Type Safety

Applies to every statically-typeable language (TypeScript, Java, Kotlin, C#, Go, Scala):

- **No unsafe escape hatches** outside justified boundary code — `any` (TypeScript), an unchecked cast, a raw `Object`/`interface{}` held past the point of deserialization. If input is untrusted (external API, user input, a parsed file), parse it into a typed shape **once**, at the boundary, then never touch the untyped form again.
- **Narrow, don't assert.** A type assertion (`as X`, an unchecked cast) claims a fact the compiler didn't verify — prefer a runtime check (a validator, a type guard, a discriminated-union tag check) that actually proves it.
- **Exhaustive handling of unions/enums/sealed types.** A `switch`/`match` over a closed set of variants must be exhaustive — adding a new variant should fail to compile (or fail a lint rule), never fall through a silent `default`.
- **Nullability is explicit.** "This may be absent" is a type-system fact (optional/nullable types), not a comment or a naming convention (`maybeFoo`).
- **Immutable by default for domain models.** Mutable state is the exception — justify it in a comment when used, don't default to it.
- Language-specific enforcement: for TypeScript, `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `@typescript-eslint/no-explicit-any` — see `reference/service-config.md`.

## Resource Lifecycle

Any long-lived resource (database pool, Redis client, gRPC channel, message queue consumer) MUST follow this contract:

| Function | Behaviour |
|----------|-----------|
| `initX()` | **Fails on double-init** — throws or returns early if already initialized; performs a connection-level health check before returning |
| `closeX()` | **Idempotent** — safe to call multiple times; never throws; resets internal state so `initX()` could be called again if needed |
| `getX()` | **Throws if uninitialized** — error message must name the resource and the required init call (`"DB not initialized — call initDb() first"`) |

### Wiring Rules

1. `initX()` is called in the **entry point** (`server.ts`, `main.py`, `main.go`) **after** the app factory returns — never inside the factory
2. `closeX()` is added to the SIGTERM/SIGINT handler in **reverse init order** (last-initialized, first-closed)
3. The signal handler MUST start a **force-exit timer** so a stalled teardown cannot hang the process indefinitely
4. The force-exit timer MUST be unref'd (Node.js) or equivalent — it must not itself keep the process alive when all other work is done

> Canonical Node.js / Fastify implementation: `reference/service-lifecycle.md`.

## Service vs. Repository Layering

Two directions, one rule: **repositories never fetch their own connection/transaction handle;
services own that handle for the duration of a use case and pass it to every repository call.**

| Layer | Owns | Never |
|-------|------|-------|
| Repository | Query/persistence logic for one aggregate; accepts the active connection/transaction handle as a parameter on every method | Fetch its own connection/transaction handle internally; contain business rules; return framework-specific row/entity types across its own boundary |
| Service | Business rules; deciding whether a use case needs a transaction; passing the same connection/transaction handle to every repository call inside one use case | Contain persistence/query logic directly; leak framework types (ORM rows, driver clients) past its own boundary |

**Why the handle flows one way (service → repository, never repository → global accessor):** if
a repository fetches its own connection instead of accepting one, a service that wraps two
repository calls in a single transaction can't guarantee both actually run inside it — one call
silently executes outside the transaction, so a failure partway through leaves partial writes
with no rollback.

> TypeScript/Drizzle instantiation — which files may import `drizzle-orm`, and the `DbClient`
> parameter pattern: `reference/service-database.md`, "Layering" and "Repository Signatures".

## DRY Enforcement

Before writing ANY code:

1. CHECK: Does this logic exist in shared/common utilities? → YES: import it
2. ASK: Will another module need this? → YES: create in shared utilities first

**Forbidden:** inline utility logic when shared version exists; duplicating logic across files.

| Metric | Target | Action |
| ------ | ------ | ------ |
| File size | ~400–500 lines | Extract when hard to navigate |
| Duplicate code blocks | 0 | Extract to shared |
| Inline utilities | 0 | Move to shared |

## Logging Standards

- **Structured:** All logs include context (user type, action, timestamp)
- **Centralized:** Single logging utility used everywhere
- **Leveled:** Appropriate levels (debug, info, warn, error)
- Log all error conditions with full context
- Log sync operations (start, success, failure)
- NEVER log sensitive data (passwords, tokens, PII)
- NEVER use `print()`/`console.log()` — use the centralized logger

## Output Quality

- No bloated abstractions or premature generalization
- No clever tricks without comments explaining why
- Match the project's idioms — don't introduce a different paradigm mid-file
- Meaningful variable names (no `temp`, `data`, `result` without context)
- Zero: deprecated APIs, stub implementations, TODO comments, duplicate implementations, backward compatibility wrappers

## Change Descriptions

After any modification:

```
CHANGES MADE:
- [file]: [what changed and why]

THINGS I DIDN'T TOUCH:
- [file]: [intentionally left alone because...]

POTENTIAL CONCERNS:
- [any risks or things to verify]
```

## Pre-Submit Checklist

- [ ] MCP server was consulted for relevant technology
- [ ] No deprecated features or syntax
- [ ] No unused imports, variables, or functions
- [ ] No duplicate logic
- [ ] Old code paths removed if replaced
- [ ] Error handling follows centralized pattern
- [ ] Code matches official documentation examples
