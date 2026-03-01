# Go API — Conventions & Package Layout

## Package Layout

```
cmd/
  server/
    main.go                 # Entry point; manual DI wiring; graceful shutdown

internal/
  config/
    config.go               # Env var loading + validation; fail fast at startup
  db/
    db.go                   # pgxpool.Connect + golang-migrate runner
    migrations/
      000001_create_tasks_table.up.sql
      000001_create_tasks_table.down.sql
  server/
    server.go               # chi router, middleware, route mounting, timeouts
    respond.go              # respond(), respondError(), decodeJSON() helpers
  task/                     # One package per domain feature (not per layer)
    model.go                # Task struct, TaskID type, DTOs, Validate(), sentinel errors
    repository.go           # Repository interface + pgxRepository implementation
    service.go              # Business logic; accepts Repository interface
    handler.go              # HTTP handlers; method receiver on Handler struct

go.mod
go.sum
Makefile
Dockerfile
docker-compose.yml
.golangci.yml
.env                        # Local dev only — never commit
```

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Packages | lowercase, single word | `task`, `server`, `config` |
| Exported types | PascalCase | `TaskID`, `CreateTaskRequest`, `Repository` |
| Unexported types | camelCase | `pgxRepository`, `validationMsg` |
| Interfaces | noun or noun+`er` | `Repository`, `Stringer` — NOT `IRepository` |
| Constructors | `New<Type>` | `NewService`, `NewHandler`, `NewRepository` |
| Error vars | `Err<Condition>` | `ErrNotFound`, `ErrConflict` |
| Error types | `<Condition>Error` | `ValidationError`, `NotFoundError` |
| Test files | `<file>_test.go` | `service_test.go`, `handler_test.go` |
| Test funcs | `Test<Subject>_<scenario>` | `TestService_Create_duplicateTitle` |
| Benchmarks | `Benchmark<Subject>` | `BenchmarkRepository_FindAll` |
| SQL queries | `const q = ...` | inline named constant in each function |
| Config fields | PascalCase | `DatabaseURL`, `Port`, `LogLevel` |

---

## Idiomatic Go Checklist

### Interfaces — define at the call site

```go
// ❌ Interface defined in the implementation package — forces import coupling
// package repository
type Repository interface { FindByID(...) }

// ✅ Interface defined where it is consumed — service package owns the contract
// package task
type Repository interface {
    FindByID(ctx context.Context, id TaskID) (Task, error)
    Save(ctx context.Context, t Task) error
}
// Concrete pgxRepository in the same package satisfies it implicitly
```

### Return concrete types from constructors

```go
// ❌ Returns interface — hides type, harder to navigate
func NewRepository(pool *pgxpool.Pool) Repository { return &pgxRepository{pool} }

// ✅ Returns concrete type — callers can see exactly what they have
// (but accept the interface in function parameters)
func NewRepository(pool *pgxpool.Pool) *pgxRepository { return &pgxRepository{pool} }
```

> Exception: when the concrete type is intentionally hidden (e.g., an unexported type that only satisfies the interface), returning the interface is correct.

### Error handling — explicit, immediate, wrapped

```go
// ❌ Ignored error
rows, _ := pool.Query(ctx, q)

// ❌ No context added
if err != nil { return err }

// ✅ Check immediately, wrap with operation context
rows, err := pool.Query(ctx, q)
if err != nil {
    return nil, fmt.Errorf("findAll query: %w", err)
}
defer rows.Close()
```

### `context.Context` — always first, always passed

```go
// ❌ Context stored in a struct
type Service struct { ctx context.Context }

// ❌ Context not threaded through
func (s *Service) Create(req CreateTaskRequest) (Task, error) {
    s.repo.Save(context.Background(), t)  // wrong — ignores caller deadline
}

// ✅ Context passed as first parameter every time
func (s *Service) Create(ctx context.Context, req CreateTaskRequest) (Task, error) {
    return s.repo.Save(ctx, t)
}
```

### `errors.Is` / `errors.As` — never compare error strings

```go
// ❌ String comparison — breaks wrapping
if err.Error() == "task not found" { ... }

// ❌ Type switch without errors.As — misses wrapped errors
if _, ok := err.(*pgx.PgError); ok { ... }

// ✅ errors.Is — works through wrapping chain
if errors.Is(err, ErrNotFound) { ... }

// ✅ errors.As — extracts structured data through wrapping
var valErr *ValidationError
if errors.As(err, &valErr) {
    // use valErr.Fields
}
```

### Goroutines — always bound to a lifetime

```go
// ❌ Fire-and-forget — goroutine may outlive the request/server
go doBackground()

// ✅ Goroutine lifecycle tied to a context
go func() {
    select {
    case <-ctx.Done():
        return
    case result := <-workCh:
        process(result)
    }
}()

// ✅ errgroup for concurrent work that must all complete
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return doA(ctx) })
g.Go(func() error { return doB(ctx) })
if err := g.Wait(); err != nil { ... }
```

### No `init()` for business logic

```go
// ❌ Hidden side effects, impossible to test
func init() { db = connectDatabase() }

// ✅ Explicit initialisation in main()
func main() {
    pool, err := db.Connect(ctx, cfg.DatabaseURL)
    if err != nil { log.Fatal(err) }
}
```

### Short variable names are fine — in small scopes

```go
// ✅ Fine: loop variable, error check, short function
for _, t := range tasks { ... }
if err := s.repo.Save(ctx, t); err != nil { ... }

// ❌ Single letters in large functions or function parameters
func process(u User, r *http.Request, w http.ResponseWriter) { ... }  // confusing at scale
```

### No naked `return` in non-trivial functions

```go
// ❌ Naked return — hard to trace what's returned
func findUser(id string) (user User, err error) {
    user, err = repo.Find(id)
    return
}

// ✅ Explicit return — readable at the call site
func findUser(id string) (User, error) {
    return repo.Find(id)
}
```

---

## Layer Boundaries

```
Handler → Service → Repository → Database
   ↓          ↓           ↓
  DTOs     Domain      SQL/pgx
```

- **Handler**: Parse request, call service, write response. No SQL, no business logic.
- **Service**: Business logic only. Returns `(T, error)`. No `http.ResponseWriter`, no `http.Request`.
- **Repository**: SQL only. Returns domain types or sentinel errors. No business rules.
- **Domain (`model.go`)**: Pure data + validation. No framework imports.

**Cross-layer rules:**
- Never import `net/http` in service or repository packages
- Never expose `pgx.Row` or `pgxpool.Pool` above the repository package
- Never use `json.Marshal` in service or repository — that belongs to the handler layer
- Sentinel errors (`ErrNotFound`, `ErrConflict`) flow up unchanged; handler maps them to HTTP status codes
