# Go API — Review Checklist

Used by the `golang-developer` agent during code review. Every item must be explicitly verified.

---

## 1. Error Handling

- [ ] Every `err` return value is checked immediately — no `_` without a comment explaining why
- [ ] Errors are wrapped with context: `fmt.Errorf("operation: %w", err)` — always `%w` not `%v`
- [ ] `errors.Is` / `errors.As` used for error inspection — never string comparison
- [ ] Sentinel errors defined with `var Err<X> = errors.New(...)` for errors callers need to match
- [ ] Custom error types used only when callers need structured data beyond the message
- [ ] No silent catches: `catch { return nil, nil }` or `catch { /* nothing */ }`
- [ ] `CancellationError` / `context.Canceled` / `context.DeadlineExceeded` handled correctly (not wrapped away)
- [ ] HTTP handler maps `ErrNotFound` → 404, `ErrConflict` → 409, `ValidationError` → 400, unknown → 500

---

## 2. Concurrency

- [ ] Every goroutine has a defined lifetime — no fire-and-forget `go func()` without a way to stop it
- [ ] `context.Context` is passed to every function that does I/O or blocks
- [ ] `sync.WaitGroup` or `errgroup` used when waiting for multiple goroutines
- [ ] Shared mutable state protected with `sync.Mutex` — critical section is as small as possible
- [ ] `t.Parallel()` called in tests that can run concurrently; loop variable captured (`tc := tc`)
- [ ] No `time.Sleep` in production code for synchronisation — use channels or `sync` primitives
- [ ] Server has `ReadTimeout`, `WriteTimeout`, `IdleTimeout` set — no unbounded connections
- [ ] Graceful shutdown implemented: signal listener + `srv.Shutdown(ctx)` with deadline

---

## 3. Interfaces & Abstractions

- [ ] Interface defined where it is consumed (service package), not where it is implemented
- [ ] Interface has ≤ 3 methods — split if larger
- [ ] No `I<Foo>` prefixed interface names — Go convention is just `Foo`
- [ ] No interface where there is only one implementation and no test need — YAGNI
- [ ] `accept interfaces, return structs` — constructor returns concrete type; params accept interface

---

## 4. Package & File Structure

- [ ] Packages are domain-grouped: `internal/task/` holds handler, service, and repo — not split by layer
- [ ] No cyclic imports — `go build ./...` is the quickest check
- [ ] `internal/` used for packages not intended for external consumption
- [ ] `cmd/<binary>/main.go` is the only entry point; does nothing but wire and start
- [ ] No business logic in `main.go` — wiring only
- [ ] Package names are lowercase, single-word, descriptive nouns — no `utils`, `helpers`, `common`

---

## 5. `context.Context`

- [ ] `ctx context.Context` is the **first parameter** of every function that performs I/O or may block
- [ ] Context is never stored in a struct field
- [ ] `context.Background()` only used in `main.go` or test setup — never in library code
- [ ] `context.TODO()` is never left in submitted code — replace with real context
- [ ] Context values used only for request-scoped data (trace ID, user ID) — not for optional function params

---

## 6. HTTP Handlers

- [ ] Handlers only: parse request, call service, write response — zero business logic
- [ ] `r.Context()` passed to every service call — not `context.Background()`
- [ ] JSON decoded with `dec.DisallowUnknownFields()` — rejects unknown fields
- [ ] `Content-Type: application/json` set on all JSON responses
- [ ] HTTP status code set before writing body — `w.WriteHeader()` before `json.NewEncoder(w).Encode()`
- [ ] Handlers do not leak internal error messages — `500` responses show generic message, not stack trace
- [ ] URL path params validated before use — `ParseTaskID(chi.URLParam(r, "id"))` with error check

---

## 7. Database (pgx)

- [ ] `pgxpool.Pool` used (not single `pgx.Conn`) for concurrent request handling
- [ ] `rows.Close()` called via `defer` immediately after `pool.Query()`
- [ ] `rows.Err()` checked after `rows.Next()` loop
- [ ] SQL queries are `const` string variables — not built by string concatenation
- [ ] No string interpolation in SQL — always use `$1`, `$2` positional parameters
- [ ] `pgx.ErrNoRows` mapped to domain `ErrNotFound` in the repository — not propagated up
- [ ] Transactions used when multiple writes must be atomic
- [ ] Migrations embedded with `//go:embed` and run at startup via `golang-migrate`

---

## 8. Configuration

- [ ] All config loaded from environment variables — not hardcoded
- [ ] Config validated at startup in `config.Load()` — process exits with clear error if required var missing
- [ ] No `os.Getenv` scattered in business logic — config struct passed explicitly
- [ ] Secrets never logged — `slog.Info("db connected")` not `slog.Info("db connected", "url", cfg.DatabaseURL)`

---

## 9. Logging (`log/slog`)

- [ ] `slog` used everywhere — no `fmt.Println`, `log.Printf` in production code
- [ ] `slog.ErrorContext(ctx, ...)` used in request handlers — passes trace ID from context
- [ ] Structured key-value pairs used: `slog.Info("task created", "taskID", id.String())` not `fmt.Sprintf`
- [ ] No sensitive data logged (passwords, tokens, PII)
- [ ] 5xx errors logged at `Error` level; 4xx at `Warn` or not at all (client errors, not server errors)

---

## 10. Testing

- [ ] Table-driven tests used for multiple scenarios — one `tests := []struct{...}` block per function
- [ ] `t.Parallel()` called in every test that does not share state
- [ ] Loop variable captured (`tc := tc`) in tests that call `t.Parallel()` (required before Go 1.22)
- [ ] `require` used when test cannot continue after failure; `assert` for independent checks
- [ ] Mocks are minimal hand-written structs — no reflection-based mocking framework
- [ ] `httptest.NewRecorder` used for handler tests — no live server needed for unit tests
- [ ] Integration tests tagged with `//go:build integration` — not run in normal `go test ./...`
- [ ] Race detector enabled in CI: `go test -race -count=1 ./...`
- [ ] No `time.Sleep` in tests — use channels or `httptest.Server.Close()`
- [ ] Test names: `Test<Subject>_<scenario>` — e.g., `TestService_Create_duplicateTitle`

---

## 11. Code Quality

- [ ] No exported functions/types without a doc comment
- [ ] No unused imports — `go vet` and `goimports` catch this
- [ ] No unused variables — `go vet` catches this
- [ ] No `TODO`/`FIXME` in submitted code
- [ ] Function length ≤ 40 lines — extract if longer
- [ ] `go mod tidy` run — `go.mod` and `go.sum` are clean
- [ ] `golangci-lint run` passes with zero warnings

---

## Pre-Submit Gate

```
□ Errors       — every err checked, wrapped, and mapped correctly
□ Concurrency  — goroutines bounded, context threaded, server has timeouts
□ Interfaces   — defined at call site, ≤ 3 methods, no unnecessary abstraction
□ Structure    — domain-grouped packages, no business logic in main
□ Context      — first param on all I/O, never stored in struct
□ Handlers     — parse/call/respond only, context passed, no internal leaks
□ Database     — pool used, rows closed, no string SQL interpolation
□ Config       — env vars only, validated at startup, secrets not logged
□ Logging      — slog only, structured, no sensitive data
□ Testing      — table-driven, t.Parallel(), race detector, integration tagged
□ Quality      — go vet + golangci-lint pass, go mod tidy, no TODOs
```
