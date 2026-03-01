---
name: golang-api
description: Skill for Go 1.23+ REST API development with chi router, pgx/v5, golang-migrate, slog, and testify. Activate when creating HTTP handlers, services, repositories, domain models, or tests in Go.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Go 1.23+ REST API Skill

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Router | `chi v5` | Idiomatic `net/http` compatible, composable middleware, no magic |
| DB driver | `pgx/v5` | Modern PostgreSQL driver; better performance than `lib/pq` |
| Migrations | `golang-migrate` | CLI + embedded migrations, no ORM lock-in |
| Logging | `log/slog` (stdlib) | Structured JSON logging, zero dependencies, Go 1.21+ |
| Validation | Manual + custom errors | Go idiom — no reflection magic; explicit beats implicit |
| DI | Manual constructor injection | No framework; explicit wiring in `main.go` |
| Testing | `testify` + `httptest` + `testcontainers-go` | Idiomatic, no reflection mocking |
| Linting | `golangci-lint` | Comprehensive, CI-ready |
| Layout | Domain-grouped (`internal/<domain>/`) | Handler + service + repo per domain |

## Process

1. Read `reference/golang-api-config.md` — exact `go.mod`, `Makefile`, `Dockerfile`, config struct
2. Read `reference/golang-api-templates.md` — `main.go`, handler, service, repository, domain model templates
3. Wire dependencies manually in `cmd/server/main.go` — **no DI framework**
4. `context.Context` is the first parameter of every function that does I/O
5. Run `make lint test build` before finishing

## Common Commands

```bash
go run ./cmd/server/...     # Start dev server (port 8080)
go test ./...               # Run all tests
go test -race ./...         # Run with race detector (always in CI)
go build ./...              # Compile all packages
go vet ./...                # Static analysis (built-in)
golangci-lint run           # Full lint suite
go mod tidy                 # Clean up go.mod / go.sum
make migrate-up             # Run pending migrations
make migrate-down           # Roll back last migration
```

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| Domain IDs | `type TaskID uuid.UUID` — named type, not raw `uuid.UUID` alias |
| Errors | Sentinel `var ErrNotFound = errors.New(...)` + custom types for structured info |
| Repository | Interface defined in the **service** package; concrete `pgx` impl in `internal/<domain>/` |
| Service | Accepts interface repo; returns `(T, error)` — no HTTP concepts |
| Handler | `func(w http.ResponseWriter, r *http.Request)` — method on a struct holding the service |
| Request validation | Explicit struct + validate method; return `400` on invalid input |
| Error response | JSON `{"error":"...", "code":"..."}` via shared `respond` helper |
| Config | `internal/config/config.go` — struct loaded from env vars, validated at startup |
| Middleware | `func(http.Handler) http.Handler` — mounted via `chi.Use()` |
| Migrations | Embedded in binary via `//go:embed` + `golang-migrate` |

## Reference Files

| File | Content |
|------|---------|
| `reference/golang-api-config.md` | `go.mod`, `Makefile`, `Dockerfile`, `docker-compose.yml`, config struct |
| `reference/golang-api-templates.md` | `main.go`, config, server, handler, service, repository, domain, error, respond helper templates |
| `reference/golang-api-conventions.md` | Package layout, naming rules, Go idioms checklist, layer boundaries |
| `reference/golang-api-testing.md` | Table-driven unit tests, `httptest` handler tests, `testcontainers-go` integration tests |
| `reference/golang-api-review-checklist.md` | Review checklist (used by `golang-developer` agent) |

## Documentation Sources

Before generating code, verify against current docs:

| Source | Tool | What to check |
|--------|------|---------------|
| Go stdlib | Context7 MCP (`golang/go`) | `net/http`, `log/slog`, `context`, `database/sql`, `errors` |
| chi | Context7 MCP (`go-chi/chi`) | Router, middleware, URL params |
| pgx | Context7 MCP (`jackc/pgx`) | `pgxpool`, `pgx.Rows`, named args, error types |
| golang-migrate | Context7 MCP (`golang-migrate/migrate`) | Embedded source, pgx driver |
| testify | Context7 MCP (`stretchr/testify`) | `assert`, `require`, `mock` |

## Error Handling

- **Not found**: Return `ErrNotFound` sentinel from repo → service propagates → handler maps to 404
- **Validation**: Validate input struct explicitly → return `ValidationError{Field, Message}` → handler maps to 400
- **Conflict**: Return `ErrConflict` from service → handler maps to 409
- **DB errors**: Wrap with `fmt.Errorf("findTask: %w", err)` — add operation context, never swallow
- **Unexpected**: Log with `slog.Error`, return 500. Never expose internal error details in the response body
- Never use `panic` for expected errors — only for truly unrecoverable programmer errors
