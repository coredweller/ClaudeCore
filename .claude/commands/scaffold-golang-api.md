---
description: Scaffold a new Go 1.23+ REST API with chi, pgx/v5, golang-migrate, slog, and a sample endpoint
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs
disable-model-invocation: true
---

# Scaffold Go 1.23+ REST API

**Project name:** $ARGUMENTS (default to "my-go-api" if not provided)

Delegate to the `golang-api` skill for all patterns, templates, and reference files.

## Pre-requisites

1. Read the `golang-api` skill (`SKILL.md` and all reference files) before writing any code.
2. Use Context7 MCP (`resolve-library-id` then `query-docs`) to verify current chi, pgx, and golang-migrate APIs before generating code. Key libraries: `go-chi/chi`, `jackc/pgx`, `golang-migrate/migrate`.
3. Verify Go 1.23 stdlib APIs (`log/slog`, `net/http` ServeMux patterns, `errors.Is`/`errors.As`) against Context7 — do NOT generate pre-Go 1.21 patterns (old `log` package, `ioutil`, deprecated `io/fs` usage).

> **Naming note:** The scaffold uses `Task` as the sample domain. When adapting for your own domain, avoid names that shadow stdlib packages (`error`, `type`, `context`, etc.) or common import aliases.

## Steps

1. **Initialise the module** — Run `go mod init github.com/company/$ARGUMENTS`. Create `go.mod` per skill config reference (`reference/golang-api-config.md`). Pin exact versions for: `go-chi/chi/v5`, `golang-migrate/migrate/v4`, `google/uuid`, `jackc/pgx/v5`, `stretchr/testify`, `testcontainers/testcontainers-go`. Run `go mod tidy`.

2. **Create directory structure** — Create all directories upfront:
   ```
   cmd/server/
   internal/config/
   internal/db/migrations/
   internal/server/
   internal/task/
   ```

3. **Create `Makefile`** — With targets: `build`, `run`, `test`, `lint`, `migrate-up`, `migrate-down`, `tidy`. Read `reference/golang-api-config.md` for the exact template.

4. **Create `internal/config/config.go`** — `Config` struct with `Port`, `DatabaseURL`, `LogLevel` fields. `Load()` reads from env vars, returns `(*Config, error)` with a descriptive error if `DATABASE_URL` is missing. Validate `PORT` is numeric. Use `getEnvOrDefault` helper for optional vars. Fail fast — no default for required secrets. Read `reference/golang-api-config.md` for the exact template.

5. **Create `internal/db/db.go`** — `Connect(ctx, databaseURL)` returns `(*pgxpool.Pool, error)` wrapping `pgxpool.New` + `Ping`. `Migrate(databaseURL)` uses `//go:embed migrations/*.sql` + `iofs.New` + `golang-migrate` to run pending migrations. Log migration count on success. Read `reference/golang-api-templates.md` for the exact template.

6. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to Go or general cross-cutting concerns like `code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`, and `code-reviewer`.

7. **Create Flyway migrations** — Create `internal/db/migrations/000001_create_tasks_table.up.sql` and `000001_create_tasks_table.down.sql`. `up` creates the `tasks` table (`id UUID PRIMARY KEY`, `title VARCHAR(255) NOT NULL`, `description TEXT NOT NULL DEFAULT ''`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`) with a unique index on `title` and a descending index on `created_at`. `down` drops the table. Read `reference/golang-api-templates.md` for the exact SQL.

8. **Create `internal/task/model.go`** — Domain model + DTOs in one file:
   - `type TaskID uuid.UUID` — named type with `NewTaskID()`, `ParseTaskID(string) (TaskID, error)`, and `String() string`
   - `type Task struct` — with `ID TaskID`, `Title string`, `Description string`, `CreatedAt time.Time`, `UpdatedAt time.Time`
   - `type CreateTaskRequest struct` — with `json` struct tags; `Validate() error` method that returns `*ValidationError` when title is blank or > 255 chars
   - `type TaskResponse struct` — UUID and time fields as `string` (RFC 3339); `toResponse(Task) TaskResponse` unexported mapper
   - `var ErrNotFound = errors.New(...)` and `var ErrConflict = errors.New(...)` sentinel errors
   - `type ValidationError struct { Fields []string }` with `Error() string` method
   Read `reference/golang-api-templates.md` for the exact template.

9. **Create `internal/task/repository.go`** — Interface defined in the task package (at the call site):
   - `type Repository interface` with `FindByID`, `FindAll`, `Save`, `Delete`, `ExistsByTitle`
   - `type pgxRepository struct { pool *pgxpool.Pool }` implementing all methods
   - `NewRepository(pool *pgxpool.Pool) Repository` — returns the interface
   - Every method: `const q = ...` for the SQL, check `pgx.ErrNoRows` → `ErrNotFound`, wrap all other errors with `fmt.Errorf("operation: %w", err)`
   - `rows.Close()` deferred immediately after `pool.Query()`, `rows.Err()` checked after the loop
   - No string interpolation in SQL — only `$1`, `$2` positional params
   Read `reference/golang-api-templates.md` for the exact template.

10. **Create `internal/task/service.go`** — `type Service struct { repo Repository }` with `NewService(repo Repository) *Service`:
    - `GetByID(ctx, TaskID) (Task, error)` — propagate `ErrNotFound` unchanged; wrap other errors
    - `List(ctx) ([]Task, error)` — wrap repo error
    - `Create(ctx, CreateTaskRequest) (Task, error)` — validate first (return `ValidationError`), check `ExistsByTitle` (return `ErrConflict`), then `Save`; log `slog.Info("task created", "taskID", ...)` on success
    - `Delete(ctx, TaskID) error` — propagate `ErrNotFound` unchanged; wrap other errors; log on success
    - No `http` imports — this package has no knowledge of HTTP
    Read `reference/golang-api-templates.md` for the exact template.

11. **Create `internal/server/respond.go`** — Three unexported helpers used by all handlers:
    - `respond(w, status, body)` — sets `Content-Type: application/json`, calls `w.WriteHeader`, encodes with `json.NewEncoder(w).Encode(body)`, logs encode errors
    - `respondError(w, r, status, message)` — calls `slog.ErrorContext` for 5xx; calls `respond` with `map[string]string{"error": message}`
    - `decodeJSON(r, dst)` — `json.NewDecoder` with `DisallowUnknownFields()`
    Read `reference/golang-api-templates.md` for the exact template.

12. **Create `internal/task/handler.go`** — `type Handler struct { svc *Service }` with `NewHandler(svc *Service) *Handler`. Implement four methods:
    - `List(w, r)` — call `svc.List(r.Context())`, map to `[]TaskResponse`, respond 200
    - `GetByID(w, r)` — `ParseTaskID(chi.URLParam(r, "id"))` → 400 on parse error; `errors.Is(err, ErrNotFound)` → 404; unknown err → 500
    - `Create(w, r)` — `decodeJSON` → 400; `errors.As(err, &valErr)` → 400 with fields; `errors.Is(err, ErrConflict)` → 409; success → 201
    - `Delete(w, r)` — parse ID → 400; not found → 404; success → 204 `w.WriteHeader` only
    - Import `server` package for respond helpers; no business logic
    Read `reference/golang-api-templates.md` for the exact template.

13. **Create `internal/server/server.go`** — `New(port string, taskHandler *task.Handler) *http.Server`:
    - Build `chi.NewRouter()` with middleware: `RequestID`, `RealIP`, `Logger`, `Recoverer`, `Timeout(30s)`
    - `GET /api/v1/health` → inline handler returning `{"status":"ok","timestamp":"<RFC3339>"}`
    - `r.Route("/api/v1/tasks", ...)` mounting all four task handler methods
    - Return `*http.Server` with `ReadTimeout: 10s`, `WriteTimeout: 30s`, `IdleTimeout: 60s`
    Read `reference/golang-api-templates.md` for the exact template.

14. **Create `cmd/server/main.go`** — Entry point with manual DI wiring and graceful shutdown:
    - Set up `slog.NewJSONHandler` with level from config, call `slog.SetDefault`
    - `config.Load()` → exit 1 on error
    - `db.Connect(ctx, cfg.DatabaseURL)` → exit 1 on error; `defer pool.Close()`
    - `db.Migrate(cfg.DatabaseURL)` → exit 1 on error
    - Manual DI: `task.NewRepository(pool)` → `task.NewService(repo)` → `task.NewHandler(svc)`
    - `server.New(cfg.Port, taskHandler)` → `srv.ListenAndServe()` in a goroutine
    - Signal listener: `signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)`; `<-quit` blocks until signal; `srv.Shutdown(ctx with 10s timeout)`
    No business logic in `main.go` — only wiring and lifecycle management.
    Read `reference/golang-api-templates.md` for the exact template.

15. **Add `.gitignore`** — Cover: `bin/`, `*.exe`, `*.test`, `*.out`, `.env`, `vendor/`, `.idea/`, `.vscode/`, `*.log`, `coverage.out`.

16. **Add Docker support** — Two-stage `Dockerfile`: `golang:1.23-alpine` build stage (`go mod download`, `CGO_ENABLED=0 go build -ldflags="-s -w"`) and `gcr.io/distroless/static-debian12` runtime stage. Add `docker-compose.yml` with app (port 8080, `DATABASE_URL` env) and `postgres:17-alpine` service with health check. Read `reference/golang-api-config.md` for exact templates.

17. **Add `.golangci.yml`** — Enable: `errcheck`, `govet`, `staticcheck`, `unused`, `gofmt`, `goimports`, `revive`, `gosec`, `bodyclose`, `contextcheck`. Set `goimports.local-prefixes` to the module path. Read `reference/golang-api-config.md` for the exact config.

18. **Write unit tests** — Create `internal/task/service_test.go` in package `task_test`. Define `mockRepo` struct implementing `Repository` with function fields (one per interface method) for per-test control. Write table-driven tests with `t.Parallel()` and loop variable capture (`tc := tc`) for:
    - `TestService_GetByID`: found → `(Task, nil)`; not found → `(zero, ErrNotFound)`; DB error → wrapped error
    - `TestService_Create`: valid request → task created + `Save` called; empty title → `*ValidationError` + `Save` NOT called; duplicate title → `ErrConflict` + `Save` NOT called
    - `TestService_Delete`: success → nil + `Delete` called; not found → `ErrNotFound`
    Use `require` for fatal assertions, `assert` for independent checks. Read `reference/golang-api-testing.md` for the mock struct pattern.

19. **Write handler tests** — Create `internal/task/handler_test.go` in package `task_test`. Use `httptest.NewRecorder` and `httptest.NewRequest`. Set chi URL params via `chi.NewRouteContext()` + `context.WithValue`. Write table-driven tests for:
    - `TestHandler_GetByID`: 200 found; 404 not found; 400 invalid UUID
    - `TestHandler_Create`: 201 valid; 400 empty title; 409 duplicate; 400 bad JSON
    - `TestHandler_Delete`: 204 success; 404 not found; 400 invalid UUID
    Read `reference/golang-api-testing.md` for the exact `httptest` pattern.

20. **Add integration test** — Create `internal/task/repository_integration_test.go` with `//go:build integration` tag. Use `testcontainers-go/modules/postgres` to spin up `postgres:17-alpine`. Call `db.Connect` and `db.Migrate` against the container. Test `Save`→`FindByID` round-trip, `ErrNotFound` for missing ID, `ExistsByTitle` before and after save. Read `reference/golang-api-testing.md` for the Testcontainers pattern.

21. **Verify** — Run `go build ./...` (zero errors), `go vet ./...` (zero warnings), `go test -race -count=1 ./...` (all green), `go mod tidy` (no diff). If `golangci-lint` is installed locally, run `golangci-lint run`. Fix any issues before reporting done.

22. **Print summary** — List all created files with one-line descriptions. Print `go run ./cmd/server` to start (default port 8080). List next steps: add JWT auth middleware, add `//go:build integration` test run to CI (`go test -race -tags integration ./...`), add OpenAPI spec via `swaggo/swag`, add `pprof` endpoint for profiling.
