# Go API — Testing Patterns

Stack: **testify** + **httptest** + **testcontainers-go** + race detector

---

## Test Dependencies

```go
// go.mod test deps (already in go.mod require block)
github.com/stretchr/testify       v1.10.0
github.com/testcontainers/testcontainers-go v0.35.0
```

---

## Unit Test — Service with Interface Mock

Go idiom: define a minimal mock struct that satisfies the interface. No reflection mocking framework.

```go
// internal/task/service_test.go
package task_test

import (
    "context"
    "errors"
    "testing"
    "time"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
    "github.com/company/my-service/internal/task"
)

// mockRepo satisfies task.Repository with controllable behaviour per test.
type mockRepo struct {
    findByID    func(ctx context.Context, id task.TaskID) (task.Task, error)
    findAll     func(ctx context.Context) ([]task.Task, error)
    save        func(ctx context.Context, t task.Task) error
    delete      func(ctx context.Context, id task.TaskID) error
    existsByTitle func(ctx context.Context, title string) (bool, error)
}

func (m *mockRepo) FindByID(ctx context.Context, id task.TaskID) (task.Task, error) {
    return m.findByID(ctx, id)
}
func (m *mockRepo) FindAll(ctx context.Context) ([]task.Task, error) {
    return m.findAll(ctx)
}
func (m *mockRepo) Save(ctx context.Context, t task.Task) error {
    return m.save(ctx, t)
}
func (m *mockRepo) Delete(ctx context.Context, id task.TaskID) error {
    return m.delete(ctx, id)
}
func (m *mockRepo) ExistsByTitle(ctx context.Context, title string) (bool, error) {
    return m.existsByTitle(ctx, title)
}

func TestService_GetByID(t *testing.T) {
    t.Parallel()

    now := time.Now().UTC()
    taskID := task.NewTaskID()
    fixture := task.Task{ID: taskID, Title: "Test task", CreatedAt: now, UpdatedAt: now}

    tests := []struct {
        name      string
        repoErr   error
        repoTask  task.Task
        wantErr   error
    }{
        {
            name:     "found — returns task",
            repoTask: fixture,
            repoErr:  nil,
            wantErr:  nil,
        },
        {
            name:    "not found — returns ErrNotFound",
            repoErr: task.ErrNotFound,
            wantErr: task.ErrNotFound,
        },
        {
            name:    "db error — returns wrapped error",
            repoErr: errors.New("connection reset"),
            wantErr: nil, // non-sentinel; check with assert.Error
        },
    }

    for _, tc := range tests {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()

            repo := &mockRepo{
                findByID: func(_ context.Context, _ task.TaskID) (task.Task, error) {
                    return tc.repoTask, tc.repoErr
                },
            }
            svc := task.NewService(repo)

            got, err := svc.GetByID(context.Background(), taskID)

            if tc.wantErr != nil {
                require.ErrorIs(t, err, tc.wantErr)
            } else if tc.repoErr != nil {
                require.Error(t, err)
            } else {
                require.NoError(t, err)
                assert.Equal(t, fixture.Title, got.Title)
            }
        })
    }
}

func TestService_Create(t *testing.T) {
    t.Parallel()

    tests := []struct {
        name          string
        req           task.CreateTaskRequest
        titleExists   bool
        saveErr       error
        wantErr       error
        wantValErr    bool
    }{
        {
            name:        "valid request — creates task",
            req:         task.CreateTaskRequest{Title: "New task"},
            titleExists: false,
            wantErr:     nil,
        },
        {
            name:       "empty title — validation error",
            req:        task.CreateTaskRequest{Title: ""},
            wantValErr: true,
        },
        {
            name:        "duplicate title — conflict",
            req:         task.CreateTaskRequest{Title: "Existing task"},
            titleExists: true,
            wantErr:     task.ErrConflict,
        },
    }

    for _, tc := range tests {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()

            saveCalled := false
            repo := &mockRepo{
                existsByTitle: func(_ context.Context, _ string) (bool, error) {
                    return tc.titleExists, nil
                },
                save: func(_ context.Context, _ task.Task) error {
                    saveCalled = true
                    return tc.saveErr
                },
            }
            svc := task.NewService(repo)

            got, err := svc.Create(context.Background(), tc.req)

            if tc.wantValErr {
                var valErr *task.ValidationError
                require.ErrorAs(t, err, &valErr)
                assert.False(t, saveCalled, "save must not be called on validation failure")
                return
            }
            if tc.wantErr != nil {
                require.ErrorIs(t, err, tc.wantErr)
                assert.False(t, saveCalled, "save must not be called on conflict")
                return
            }
            require.NoError(t, err)
            assert.Equal(t, tc.req.Title, got.Title)
            assert.True(t, saveCalled)
        })
    }
}
```

---

## Handler Test — `httptest.NewRecorder`

```go
// internal/task/handler_test.go
package task_test

import (
    "bytes"
    "context"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"
    "time"

    "github.com/go-chi/chi/v5"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
    "github.com/company/my-service/internal/task"
)

func TestHandler_GetByID(t *testing.T) {
    t.Parallel()

    now := time.Now().UTC()
    taskID := task.NewTaskID()
    fixture := task.Task{ID: taskID, Title: "Hello", CreatedAt: now, UpdatedAt: now}

    tests := []struct {
        name       string
        pathID     string
        repoResult task.Task
        repoErr    error
        wantStatus int
    }{
        {
            name:       "found — 200",
            pathID:     taskID.String(),
            repoResult: fixture,
            wantStatus: http.StatusOK,
        },
        {
            name:       "not found — 404",
            pathID:     taskID.String(),
            repoErr:    task.ErrNotFound,
            wantStatus: http.StatusNotFound,
        },
        {
            name:       "invalid ID — 400",
            pathID:     "not-a-uuid",
            wantStatus: http.StatusBadRequest,
        },
    }

    for _, tc := range tests {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()

            repo := &mockRepo{
                findByID: func(_ context.Context, _ task.TaskID) (task.Task, error) {
                    return tc.repoResult, tc.repoErr
                },
            }
            handler := task.NewHandler(task.NewService(repo))

            // chi requires URL params set via chi.RouteContext
            rctx := chi.NewRouteContext()
            rctx.URLParams.Add("id", tc.pathID)

            req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/"+tc.pathID, nil)
            req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
            rec := httptest.NewRecorder()

            handler.GetByID(rec, req)

            assert.Equal(t, tc.wantStatus, rec.Code)
        })
    }
}

func TestHandler_Create(t *testing.T) {
    t.Parallel()

    tests := []struct {
        name       string
        body       any
        titleExists bool
        wantStatus int
    }{
        {
            name:       "valid — 201",
            body:       map[string]string{"title": "New task"},
            wantStatus: http.StatusCreated,
        },
        {
            name:       "empty title — 400",
            body:       map[string]string{"title": ""},
            wantStatus: http.StatusBadRequest,
        },
        {
            name:        "duplicate — 409",
            body:        map[string]string{"title": "Existing"},
            titleExists: true,
            wantStatus:  http.StatusConflict,
        },
        {
            name:       "malformed JSON — 400",
            body:       "not json",
            wantStatus: http.StatusBadRequest,
        },
    }

    for _, tc := range tests {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()

            repo := &mockRepo{
                existsByTitle: func(_ context.Context, _ string) (bool, error) {
                    return tc.titleExists, nil
                },
                save: func(_ context.Context, _ task.Task) error { return nil },
            }
            handler := task.NewHandler(task.NewService(repo))

            var bodyBytes []byte
            switch v := tc.body.(type) {
            case string:
                bodyBytes = []byte(v)
            default:
                bodyBytes, _ = json.Marshal(v)
            }

            req := httptest.NewRequest(http.MethodPost, "/api/v1/tasks", bytes.NewReader(bodyBytes))
            req.Header.Set("Content-Type", "application/json")
            rec := httptest.NewRecorder()

            handler.Create(rec, req)

            assert.Equal(t, tc.wantStatus, rec.Code)
        })
    }
}
```

---

## Integration Test — Testcontainers + Real pgxpool

```go
// internal/task/repository_integration_test.go
//go:build integration

package task_test

import (
    "context"
    "testing"
    "time"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
    "github.com/testcontainers/testcontainers-go/wait"
    "github.com/company/my-service/internal/db"
    "github.com/company/my-service/internal/task"
)

func TestRepository_Integration(t *testing.T) {
    ctx := context.Background()

    // Start postgres container
    pgContainer, err := postgres.Run(ctx,
        "postgres:17-alpine",
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        testcontainers.WithWaitStrategy(
            wait.ForLog("database system is ready to accept connections").
                WithOccurrence(2).
                WithStartupTimeout(30*time.Second),
        ),
    )
    require.NoError(t, err)
    t.Cleanup(func() { pgContainer.Terminate(ctx) })

    connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
    require.NoError(t, err)

    pool, err := db.Connect(ctx, connStr)
    require.NoError(t, err)
    t.Cleanup(pool.Close)

    require.NoError(t, db.Migrate(connStr))

    repo := task.NewRepository(pool)

    t.Run("save and findByID round-trip", func(t *testing.T) {
        now := time.Now().UTC().Truncate(time.Microsecond)
        id := task.NewTaskID()
        orig := task.Task{ID: id, Title: "Integration test", Description: "desc", CreatedAt: now, UpdatedAt: now}

        require.NoError(t, repo.Save(ctx, orig))

        found, err := repo.FindByID(ctx, id)
        require.NoError(t, err)
        assert.Equal(t, orig.Title, found.Title)
        assert.Equal(t, orig.Description, found.Description)
    })

    t.Run("findByID missing — ErrNotFound", func(t *testing.T) {
        _, err := repo.FindByID(ctx, task.NewTaskID())
        assert.ErrorIs(t, err, task.ErrNotFound)
    })

    t.Run("existsByTitle — false then true after save", func(t *testing.T) {
        exists, err := repo.ExistsByTitle(ctx, "Unique title xyz")
        require.NoError(t, err)
        assert.False(t, exists)

        now := time.Now().UTC().Truncate(time.Microsecond)
        id := task.NewTaskID()
        require.NoError(t, repo.Save(ctx, task.Task{ID: id, Title: "Unique title xyz", CreatedAt: now, UpdatedAt: now}))

        exists, err = repo.ExistsByTitle(ctx, "Unique title xyz")
        require.NoError(t, err)
        assert.True(t, exists)
    })
}
```

Run integration tests with:

```bash
go test -race -tags integration ./internal/task/...
```

---

## Table-Driven Test Conventions

```go
// ✅ Standard pattern
tests := []struct {
    name    string    // human-readable, used by t.Run
    input   T
    want    T
    wantErr bool
}{
    {name: "scenario description", input: ..., want: ..., wantErr: false},
}

for _, tc := range tests {
    tc := tc            // capture loop variable (required before Go 1.22)
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()    // if test does not share state
        // ...
    })
}
```

---

## `require` vs `assert`

```go
// require: stops the test on failure — use when subsequent code depends on this passing
id, err := ParseTaskID("bad")
require.NoError(t, err)       // stops here if err != nil
assert.Equal(t, expected, id) // only runs if above passed

// assert: records failure but continues — use for independent checks
assert.Equal(t, "expected", got.Title)
assert.NotEmpty(t, got.ID)
```

---

## Race Detector — Always On in CI

```bash
go test -race -count=1 ./...
```

`-count=1` disables test caching so failures are never hidden.

---

## Benchmark Template

```go
func BenchmarkRepository_FindAll(b *testing.B) {
    // setup outside b.N loop
    pool := setupTestDB(b)
    repo := task.NewRepository(pool)
    ctx := context.Background()

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = repo.FindAll(ctx)
    }
}
```
