# Go API — Build & Configuration

## `go.mod`

```go
module github.com/company/my-service

go 1.23

require (
    github.com/go-chi/chi/v5          v5.2.1
    github.com/golang-migrate/migrate/v4 v4.18.1
    github.com/google/uuid            v1.6.0
    github.com/jackc/pgx/v5           v5.7.2
    github.com/stretchr/testify       v1.10.0
    github.com/testcontainers/testcontainers-go v0.35.0
)
```

After editing, run `go mod tidy` to populate `go.sum`.

---

## `Makefile`

```makefile
.PHONY: build run test lint migrate-up migrate-down

BINARY   := bin/server
MAIN     := ./cmd/server
DB_URL   ?= postgres://postgres:postgres@localhost:5432/myservice?sslmode=disable

build:
	go build -o $(BINARY) $(MAIN)

run:
	go run $(MAIN)

test:
	go test -race -count=1 ./...

lint:
	go vet ./...
	golangci-lint run

migrate-up:
	migrate -database "$(DB_URL)" -path ./internal/db/migrations up

migrate-down:
	migrate -database "$(DB_URL)" -path ./internal/db/migrations down 1

tidy:
	go mod tidy
```

---

## `internal/config/config.go`

```go
package config

import (
    "fmt"
    "os"
    "strconv"
)

type Config struct {
    Port        string
    DatabaseURL string
    LogLevel    string
}

// Load reads config from environment variables.
// Returns an error if any required variable is missing.
func Load() (*Config, error) {
    dbURL := os.Getenv("DATABASE_URL")
    if dbURL == "" {
        return nil, fmt.Errorf("DATABASE_URL is required")
    }

    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }
    if _, err := strconv.Atoi(port); err != nil {
        return nil, fmt.Errorf("PORT must be a number, got %q", port)
    }

    return &Config{
        Port:        port,
        DatabaseURL: dbURL,
        LogLevel:    getEnvOrDefault("LOG_LEVEL", "info"),
    }, nil
}

func getEnvOrDefault(key, fallback string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return fallback
}
```

---

## `.env` (local dev — never commit)

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/myservice?sslmode=disable
PORT=8080
LOG_LEVEL=debug
```

---

## `.golangci.yml`

```yaml
linters:
  enable:
    - errcheck
    - govet
    - staticcheck
    - unused
    - gofmt
    - goimports
    - revive
    - gosec
    - bodyclose
    - contextcheck
    - noctx

linters-settings:
  revive:
    rules:
      - name: exported
      - name: var-naming
  goimports:
    local-prefixes: github.com/company/my-service

issues:
  exclude-rules:
    - path: _test\.go
      linters: [gosec, errcheck]
```

---

## `Dockerfile`

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o bin/server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/bin/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
```

---

## `docker-compose.yml`

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://postgres:postgres@db:5432/myservice?sslmode=disable
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: myservice
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
```

---

## Migration File Naming

```
internal/db/migrations/
  000001_create_tasks_table.up.sql
  000001_create_tasks_table.down.sql
```

Use `migrate create -ext sql -dir internal/db/migrations -seq create_tasks_table` to generate.
