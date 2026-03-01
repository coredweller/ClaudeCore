# Kotlin API — Review Checklist

Used by the `kotlin-expert` agent during code review. Each item must be explicitly verified.

---

## 1. Kotlin Idioms

- [ ] No `var` in domain models or DTOs — all fields are `val`
- [ ] No null-returning functions where `Either` or sealed error is appropriate
- [ ] Value classes (`@JvmInline value class`) used for all domain IDs — no raw `UUID` parameters
- [ ] Sealed class used for domain error hierarchy — not open classes or string codes
- [ ] No Java-style `for` loops where `map`/`filter`/`fold` are clearer
- [ ] No string concatenation — string templates or SLF4J parameterised logging used
- [ ] No `!!` (null assertion) in production code — use `?.let`, `?:`, or explicit error
- [ ] Scope functions (`apply`, `also`, `let`, `run`, `with`) used correctly and not abused
- [ ] `data class` used for DTOs; `@JvmInline value class` for IDs; plain `class` for services/repos
- [ ] Default arguments used instead of Java-style method overloads

---

## 2. Coroutines & Threading

- [ ] All I/O functions are `suspend` — no blocking calls on coroutine dispatchers
- [ ] Exposed queries use `newSuspendedTransaction(Dispatchers.IO)` — not `transaction {}`
- [ ] No `runBlocking` inside a `suspend` function
- [ ] No `GlobalScope.launch` — application scope or `coroutineScope` used instead
- [ ] `CancellationException` is never swallowed — always rethrown
- [ ] Parallel independent operations use `async`/`await` inside `coroutineScope`
- [ ] Background jobs tied to `ApplicationStopping` lifecycle — cancel scope on shutdown
- [ ] `SupervisorJob` used for independent background tasks

---

## 3. Architecture & Layer Boundaries

- [ ] Routes only: `receive<DTO>`, call service, `respond` — no business logic in routes
- [ ] Services only: business logic, `Either<DomainError, T>` returns — no `HttpStatusCode` references
- [ ] Repositories only: DB access — no business logic, no HTTP concepts
- [ ] Domain models never exposed directly in responses — always mapped to response DTOs
- [ ] Exposed `ResultRow` / `Table` objects never leak above the repository layer
- [ ] Repository interface used (not the concrete `Impl`) at injection sites

---

## 4. Error Handling

- [ ] No silent catch blocks — every catch logs the error
- [ ] No `catch (e: Exception) { return emptyList() }` — errors must be loud
- [ ] `StatusPages` plugin handles all `DomainError` subtypes explicitly
- [ ] Unexpected exceptions mapped to RFC 9457 `ProblemDetail` with `500` status
- [ ] Validation done at the route/DTO boundary using Konform — not scattered in services
- [ ] `Either` used for expected failures; exceptions reserved for unexpected states only

---

## 5. Serialization & DTOs

- [ ] All request/response types annotated with `@Serializable`
- [ ] No raw `UUID` or `Instant` in serialized types — use `String` with explicit format
- [ ] `ignoreUnknownKeys = false` in production `Json` config (fail fast on contract breaks)
- [ ] `encodeDefaults = true` so optional fields are always serialized
- [ ] No domain entity classes used as JSON response types

---

## 6. Dependency Injection (Koin)

- [ ] All dependencies declared in `module {}` blocks — no manual `object` singletons with state
- [ ] Repository interfaces injected (not concrete implementations) — testable
- [ ] No `by inject()` at class level (eager) where lazy injection suffices
- [ ] Koin module is a pure declaration file — no side effects in `module {}`

---

## 7. Database (Exposed + Flyway)

- [ ] All columns explicitly typed — no implicit defaults
- [ ] `uniqueIndex()` declared for fields with uniqueness constraints
- [ ] Primary key declared via `PrimaryKey(column)` on the `Table` object
- [ ] Migrations named correctly: `V{n}__{description}.sql` (double underscore)
- [ ] Migrations are additive — no destructive changes without `DROP` in a later migration
- [ ] `toUser()` / `toEntity()` mapper is a private function inside the repo — not exposed
- [ ] HikariCP pool size configured via `application.conf` — not hardcoded

---

## 8. Configuration

- [ ] All environment-specific values in `application.conf` with `${?ENV_VAR}` fallback syntax
- [ ] No secrets hardcoded in source — all read from environment
- [ ] `application.conf` has sensible defaults for local dev, overridable for production
- [ ] DB config, JWT config, and pool settings all use `${?}` env substitution

---

## 9. Security

- [ ] JWT secret not logged or exposed in responses
- [ ] JWT validation uses `verifySignature = true` — not `relaxed = true`
- [ ] User input validated before use (Konform) — no raw strings passed to DB
- [ ] Exposed DSL used for queries — no string-interpolated SQL
- [ ] CORS restricted to known origins — not `anyHost()` in production config
- [ ] Sensitive data (passwords, tokens) never logged

---

## 10. Testing

- [ ] Unit tests cover happy path, not-found, validation failure, and conflict cases
- [ ] `coVerify` used to assert repository interactions (no calls when validation fails, etc.)
- [ ] Integration tests use `testApplication` — no live server started
- [ ] Testcontainers used for DB integration tests — no in-memory H2 (schema drift risk)
- [ ] Test names follow `describe / context / it` pattern with full sentence `it` descriptions
- [ ] MockK used with `coEvery` (not `every`) for `suspend` functions
- [ ] No `Thread.sleep` in tests — use coroutine-aware `delay` or `runTest`

---

## 11. Code Quality

- [ ] No unused imports
- [ ] No `TODO` or `FIXME` comments left in submitted code
- [ ] File size ≤ 400 lines — extract if longer
- [ ] Function length ≤ 40 lines — extract if longer
- [ ] No magic numbers — use named constants or config values
- [ ] `logger` is an instance variable (not companion object) unless the class is a Kotlin `object`
- [ ] `./gradlew detekt ktlintCheck` passes with zero warnings

---

## Pre-Submit Gate

All boxes checked before marking review complete. Any unchecked item = review not passed.

```
□ Kotlin idioms      — no Java habits, no !!
□ Coroutines         — no blocking, no GlobalScope, CancellationException rethrown
□ Architecture       — layer boundaries clean, no leaking types
□ Error handling     — every catch logs, Either used, StatusPages covers all errors
□ Serialization      — @Serializable, no raw UUID/Instant
□ DI                 — interfaces injected, no state in module {}
□ Database           — newSuspendedTransaction, migrations additive, no hardcoded SQL
□ Config             — all secrets via ${?ENV_VAR}
□ Security           — JWT verified, input validated, no string SQL
□ Testing            — coEvery/coVerify, testApplication, Testcontainers
□ Quality            — detekt + ktlint pass, no TODOs
```
