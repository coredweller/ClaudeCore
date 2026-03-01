# Go API — Code Templates

Production-ready templates for Go 1.23+ REST API development.

---

## `cmd/server/main.go` — Entry Point & Manual DI

```go
package main

import (
    "context"
    "errors"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/company/my-service/internal/config"
    "github.com/company/my-service/internal/db"
    "github.com/company/my-service/internal/server"
    "github.com/company/my-service/internal/task"
)

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
    slog.SetDefault(logger)

    cfg, err := config.Load()
    if err != nil {
        slog.Error("failed to load config", "error", err)
        os.Exit(1)
    }

    pool, err := db.Connect(context.Background(), cfg.DatabaseURL)
    if err != nil {
        slog.Error("failed to connect to database", "error", err)
        os.Exit(1)
    }
    defer pool.Close()

    if err := db.Migrate(cfg.DatabaseURL); err != nil {
        slog.Error("migration failed", "error", err)
        os.Exit(1)
    }

    // Manual DI — wire the dependency graph explicitly
    taskRepo    := task.NewRepository(pool)
    taskService := task.NewService(taskRepo)
    taskHandler := task.NewHandler(taskService)

    srv := server.New(cfg.Port, taskHandler)

    // Graceful shutdown
    go func() {
        slog.Info("server starting", "port", cfg.Port)
        if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
            slog.Error("server error", "error", err)
            os.Exit(1)
        }
    }()

    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    slog.Info("shutting down server")
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        slog.Error("shutdown error", "error", err)
    }
}
```

---

## `internal/server/server.go` — Router Setup

```go
package server

import (
    "net/http"
    "time"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
    "github.com/company/my-service/internal/task"
)

func New(port string, taskHandler *task.Handler) *http.Server {
    r := chi.NewRouter()

    r.Use(middleware.RequestID)
    r.Use(middleware.RealIP)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    r.Use(middleware.Timeout(30 * time.Second))

    r.Get("/api/v1/health", healthHandler)

    r.Route("/api/v1/tasks", func(r chi.Router) {
        r.Get("/",        taskHandler.List)
        r.Post("/",       taskHandler.Create)
        r.Get("/{id}",   taskHandler.GetByID)
        r.Delete("/{id}", taskHandler.Delete)
    })

    return &http.Server{
        Addr:         ":" + port,
        Handler:      r,
        ReadTimeout:  10 * time.Second,
        WriteTimeout: 30 * time.Second,
        IdleTimeout:  60 * time.Second,
    }
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
    respond(w, http.StatusOK, map[string]string{
        "status":    "ok",
        "timestamp": time.Now().UTC().Format(time.RFC3339),
    })
}
```

---

## `internal/db/db.go` — pgx Pool + Migrations

```go
package db

import (
    "context"
    "embed"
    "fmt"

    "github.com/golang-migrate/migrate/v4"
    _ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
    "github.com/golang-migrate/migrate/v4/source/iofs"
    "github.com/jackc/pgx/v5/pgxpool"
    "log/slog"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
    pool, err := pgxpool.New(ctx, databaseURL)
    if err != nil {
        return nil, fmt.Errorf("pgxpool.New: %w", err)
    }
    if err := pool.Ping(ctx); err != nil {
        return nil, fmt.Errorf("pool.Ping: %w", err)
    }
    return pool, nil
}

func Migrate(databaseURL string) error {
    src, err := iofs.New(migrationsFS, "migrations")
    if err != nil {
        return fmt.Errorf("iofs.New: %w", err)
    }
    m, err := migrate.NewWithSourceInstance("iofs", src, databaseURL)
    if err != nil {
        return fmt.Errorf("migrate.New: %w", err)
    }
    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return fmt.Errorf("migrate.Up: %w", err)
    }
    slog.Info("migrations applied")
    return nil
}
```

---

## `internal/task/model.go` — Domain Model & DTOs

```go
package task

import (
    "errors"
    "time"

    "github.com/google/uuid"
)

// TaskID is a named type — prevents passing a UserID where a TaskID is expected.
type TaskID uuid.UUID

func NewTaskID() TaskID           { return TaskID(uuid.New()) }
func ParseTaskID(s string) (TaskID, error) {
    id, err := uuid.Parse(s)
    if err != nil {
        return TaskID{}, fmt.Errorf("invalid task ID %q: %w", s, err)
    }
    return TaskID(id), nil
}
func (id TaskID) String() string { return uuid.UUID(id).String() }

// Task is the domain model.
type Task struct {
    ID          TaskID
    Title       string
    Description string
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

// CreateTaskRequest is the JSON request body for POST /tasks.
type CreateTaskRequest struct {
    Title       string `json:"title"`
    Description string `json:"description"`
}

func (r CreateTaskRequest) Validate() error {
    var errs []string
    if r.Title == "" {
        errs = append(errs, "title is required")
    }
    if len(r.Title) > 255 {
        errs = append(errs, "title must not exceed 255 characters")
    }
    if len(errs) > 0 {
        return &ValidationError{Fields: errs}
    }
    return nil
}

// TaskResponse is the JSON response body — never expose the domain struct directly.
type TaskResponse struct {
    ID          string `json:"id"`
    Title       string `json:"title"`
    Description string `json:"description"`
    CreatedAt   string `json:"createdAt"`
    UpdatedAt   string `json:"updatedAt"`
}

func toResponse(t Task) TaskResponse {
    return TaskResponse{
        ID:          t.ID.String(),
        Title:       t.Title,
        Description: t.Description,
        CreatedAt:   t.CreatedAt.UTC().Format(time.RFC3339),
        UpdatedAt:   t.UpdatedAt.UTC().Format(time.RFC3339),
    }
}

// Sentinel errors — callers use errors.Is to check these.
var (
    ErrNotFound = errors.New("task not found")
    ErrConflict = errors.New("task already exists")
)

// ValidationError carries structured field-level errors.
type ValidationError struct {
    Fields []string
}

func (e *ValidationError) Error() string {
    return "validation failed: " + strings.Join(e.Fields, "; ")
}
```

---

## `internal/task/repository.go` — Interface + pgx Implementation

```go
package task

import (
    "context"
    "errors"
    "fmt"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/google/uuid"
)

// Repository is defined here, next to its consumer (the service).
// Accept interfaces, return structs.
type Repository interface {
    FindByID(ctx context.Context, id TaskID) (Task, error)
    FindAll(ctx context.Context) ([]Task, error)
    Save(ctx context.Context, t Task) error
    Delete(ctx context.Context, id TaskID) error
    ExistsByTitle(ctx context.Context, title string) (bool, error)
}

type pgxRepository struct {
    pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) Repository {
    return &pgxRepository{pool: pool}
}

func (r *pgxRepository) FindByID(ctx context.Context, id TaskID) (Task, error) {
    const q = `SELECT id, title, description, created_at, updated_at FROM tasks WHERE id = $1`

    var t Task
    var rawID uuid.UUID
    err := r.pool.QueryRow(ctx, q, uuid.UUID(id)).Scan(
        &rawID, &t.Title, &t.Description, &t.CreatedAt, &t.UpdatedAt,
    )
    if err != nil {
        if errors.Is(err, pgx.ErrNoRows) {
            return Task{}, ErrNotFound
        }
        return Task{}, fmt.Errorf("findByID: %w", err)
    }
    t.ID = TaskID(rawID)
    return t, nil
}

func (r *pgxRepository) FindAll(ctx context.Context) ([]Task, error) {
    const q = `SELECT id, title, description, created_at, updated_at FROM tasks ORDER BY created_at DESC`

    rows, err := r.pool.Query(ctx, q)
    if err != nil {
        return nil, fmt.Errorf("findAll: %w", err)
    }
    defer rows.Close()

    var tasks []Task
    for rows.Next() {
        var t Task
        var rawID uuid.UUID
        if err := rows.Scan(&rawID, &t.Title, &t.Description, &t.CreatedAt, &t.UpdatedAt); err != nil {
            return nil, fmt.Errorf("findAll scan: %w", err)
        }
        t.ID = TaskID(rawID)
        tasks = append(tasks, t)
    }
    if err := rows.Err(); err != nil {
        return nil, fmt.Errorf("findAll rows: %w", err)
    }
    return tasks, nil
}

func (r *pgxRepository) Save(ctx context.Context, t Task) error {
    const q = `INSERT INTO tasks (id, title, description, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5)`

    _, err := r.pool.Exec(ctx, q,
        uuid.UUID(t.ID), t.Title, t.Description, t.CreatedAt, t.UpdatedAt,
    )
    if err != nil {
        return fmt.Errorf("save: %w", err)
    }
    return nil
}

func (r *pgxRepository) Delete(ctx context.Context, id TaskID) error {
    const q = `DELETE FROM tasks WHERE id = $1`
    tag, err := r.pool.Exec(ctx, q, uuid.UUID(id))
    if err != nil {
        return fmt.Errorf("delete: %w", err)
    }
    if tag.RowsAffected() == 0 {
        return ErrNotFound
    }
    return nil
}

func (r *pgxRepository) ExistsByTitle(ctx context.Context, title string) (bool, error) {
    const q = `SELECT EXISTS(SELECT 1 FROM tasks WHERE title = $1)`
    var exists bool
    if err := r.pool.QueryRow(ctx, q, title).Scan(&exists); err != nil {
        return false, fmt.Errorf("existsByTitle: %w", err)
    }
    return exists, nil
}
```

---

## `internal/task/service.go`

```go
package task

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "time"
)

type Service struct {
    repo Repository
}

func NewService(repo Repository) *Service {
    return &Service{repo: repo}
}

func (s *Service) GetByID(ctx context.Context, id TaskID) (Task, error) {
    t, err := s.repo.FindByID(ctx, id)
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            return Task{}, ErrNotFound
        }
        return Task{}, fmt.Errorf("GetByID: %w", err)
    }
    return t, nil
}

func (s *Service) List(ctx context.Context) ([]Task, error) {
    tasks, err := s.repo.FindAll(ctx)
    if err != nil {
        return nil, fmt.Errorf("List: %w", err)
    }
    return tasks, nil
}

func (s *Service) Create(ctx context.Context, req CreateTaskRequest) (Task, error) {
    if err := req.Validate(); err != nil {
        return Task{}, err  // ValidationError propagates as-is
    }

    exists, err := s.repo.ExistsByTitle(ctx, req.Title)
    if err != nil {
        return Task{}, fmt.Errorf("Create: %w", err)
    }
    if exists {
        return Task{}, ErrConflict
    }

    now := time.Now().UTC()
    t := Task{
        ID:          NewTaskID(),
        Title:       req.Title,
        Description: req.Description,
        CreatedAt:   now,
        UpdatedAt:   now,
    }

    if err := s.repo.Save(ctx, t); err != nil {
        return Task{}, fmt.Errorf("Create save: %w", err)
    }

    slog.Info("task created", "taskID", t.ID.String())
    return t, nil
}

func (s *Service) Delete(ctx context.Context, id TaskID) error {
    if err := s.repo.Delete(ctx, id); err != nil {
        if errors.Is(err, ErrNotFound) {
            return ErrNotFound
        }
        return fmt.Errorf("Delete: %w", err)
    }
    slog.Info("task deleted", "taskID", id.String())
    return nil
}
```

---

## `internal/task/handler.go`

```go
package task

import (
    "errors"
    "log/slog"
    "net/http"

    "github.com/go-chi/chi/v5"
)

type Handler struct {
    svc *Service
}

func NewHandler(svc *Service) *Handler {
    return &Handler{svc: svc}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
    tasks, err := h.svc.List(r.Context())
    if err != nil {
        respondError(w, r, http.StatusInternalServerError, "failed to list tasks")
        return
    }

    resp := make([]TaskResponse, len(tasks))
    for i, t := range tasks {
        resp[i] = toResponse(t)
    }
    respond(w, http.StatusOK, resp)
}

func (h *Handler) GetByID(w http.ResponseWriter, r *http.Request) {
    id, err := ParseTaskID(chi.URLParam(r, "id"))
    if err != nil {
        respondError(w, r, http.StatusBadRequest, "invalid task ID")
        return
    }

    t, err := h.svc.GetByID(r.Context(), id)
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            respondError(w, r, http.StatusNotFound, "task not found")
            return
        }
        respondError(w, r, http.StatusInternalServerError, "failed to get task")
        return
    }
    respond(w, http.StatusOK, toResponse(t))
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateTaskRequest
    if err := decodeJSON(r, &req); err != nil {
        respondError(w, r, http.StatusBadRequest, "invalid request body")
        return
    }

    t, err := h.svc.Create(r.Context(), req)
    if err != nil {
        var valErr *ValidationError
        if errors.As(err, &valErr) {
            respond(w, http.StatusBadRequest, map[string]any{
                "error":  "validation failed",
                "fields": valErr.Fields,
            })
            return
        }
        if errors.Is(err, ErrConflict) {
            respondError(w, r, http.StatusConflict, "task with this title already exists")
            return
        }
        respondError(w, r, http.StatusInternalServerError, "failed to create task")
        return
    }
    respond(w, http.StatusCreated, toResponse(t))
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
    id, err := ParseTaskID(chi.URLParam(r, "id"))
    if err != nil {
        respondError(w, r, http.StatusBadRequest, "invalid task ID")
        return
    }

    if err := h.svc.Delete(r.Context(), id); err != nil {
        if errors.Is(err, ErrNotFound) {
            respondError(w, r, http.StatusNotFound, "task not found")
            return
        }
        respondError(w, r, http.StatusInternalServerError, "failed to delete task")
        return
    }
    w.WriteHeader(http.StatusNoContent)
}
```

---

## `internal/server/respond.go` — Shared HTTP Helpers

```go
package server

import (
    "encoding/json"
    "log/slog"
    "net/http"
)

func respond(w http.ResponseWriter, status int, body any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    if err := json.NewEncoder(w).Encode(body); err != nil {
        slog.Error("failed to encode response", "error", err)
    }
}

func respondError(w http.ResponseWriter, r *http.Request, status int, message string) {
    if status >= 500 {
        slog.ErrorContext(r.Context(), "internal error", "status", status, "message", message)
    }
    respond(w, status, map[string]string{"error": message})
}

func decodeJSON(r *http.Request, dst any) error {
    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()
    return dec.Decode(dst)
}
```

---

## `internal/db/migrations/000001_create_tasks_table.up.sql`

```sql
CREATE TABLE tasks (
    id          UUID         NOT NULL PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    description TEXT         NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL
);

CREATE UNIQUE INDEX idx_tasks_title ON tasks (title);
CREATE INDEX idx_tasks_created_at ON tasks (created_at DESC);
```

## `internal/db/migrations/000001_create_tasks_table.down.sql`

```sql
DROP TABLE IF EXISTS tasks;
```
