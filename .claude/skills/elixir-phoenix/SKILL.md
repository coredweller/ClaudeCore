---
name: elixir-phoenix
description: Skill for Elixir Phoenix Framework applications with OTP supervision, Ecto changesets, and functional domain modeling. Activate when creating Phoenix controllers, contexts, schemas, migrations, or tests.
allowed-tools: Bash, Read, Glob, Grep
---

# Elixir + Phoenix Framework Skill

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Web | Phoenix ~> 1.7 | First-class JSON APIs, LiveView, built-in telemetry |
| DB layer | Ecto ~> 3.12 + changesets | Declarative validation, composable queries, migrations |
| JSON | Jason ~> 1.4 with `@derive` | Fast, standard, zero-boilerplate encoding |
| Business logic | Phoenix Contexts | Explicit domain boundaries, no fat controllers |
| Error shape | `{:ok, value}` / `{:error, reason}` tuples | Consistent, pattern-matchable, OTP-idiomatic |
| Config | `config/runtime.exs` + `System.fetch_env!` | 12-Factor: secrets never compiled into releases |
| Testing | ExUnit `async: true` + Ecto sandbox | Parallel tests with full DB isolation |

## Process

1. Read `reference/elixir-phoenix-config.md` — exact `mix.exs`, `config/*.exs`, `.formatter.exs`, `.credo.exs`
2. Read `reference/elixir-phoenix-templates.md` — Application supervisor, Router, Context, Schema, Controller, Test templates
3. Scaffold the OTP supervision tree (`Application.start/2`) **first** — every process must be supervised
4. Use `{:ok, result}` / `{:error, reason}` for ALL context function returns; never raise for expected failures
5. Run `mix compile --warnings-as-errors && mix test` before finishing

## Common Commands

```bash
mix phx.server                   # Start dev server (port 4000, hot reload)
mix test                         # Run all tests
mix test --cover                 # Run tests with coverage (ExCoveralls)
mix compile                      # Compile only
mix format                       # Format all sources
mix format --check-formatted     # Check formatting (CI gate)
mix credo --strict               # Static analysis
mix dialyzer                     # Type checking (first run: mix dialyzer --plt)
mix ecto.gen.migration name      # Generate a migration file
mix ecto.migrate                 # Run pending migrations
mix ecto.rollback                # Roll back last migration
mix phx.gen.context Domain Model models field:type   # Generate context + schema + migration
mix release                      # Build production OTP release
mix deps.audit                   # Check for vulnerable dependencies (mix_audit)
```

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| Domain IDs | `Ecto.UUID` primary key (`@primary_key {:id, :binary_id, autogenerate: true}`) |
| Errors | `{:ok, struct}` / `{:error, %Ecto.Changeset{}}` / `{:error, :not_found}` |
| Schema | `use Ecto.Schema` + `changeset/2` function |
| Context | Plain module — public API calls `Repo` internally, never exposed outside |
| Controller | Thin: params → context call → render or `action_fallback` |
| Validation | `cast/3` + `validate_required/2` + `validate_length`, custom validators |
| Error HTTP mapping | `FallbackController` via `action_fallback MyAppWeb.FallbackController` |
| Config | `config/runtime.exs` reads `System.fetch_env!("VAR")` at boot time |
| Supervision | All workers declared in `Application.start/2` children list |

## Reference Files

| File | Content |
|------|---------|
| `reference/elixir-phoenix-config.md` | `mix.exs`, `config/config.exs`, `config/runtime.exs`, `.formatter.exs`, `.credo.exs`, Dockerfile, docker-compose.yml |
| `reference/elixir-phoenix-templates.md` | Application supervisor, Router, Context, Schema + changeset, Controller, FallbackController, Test templates |

## Documentation Sources

Before generating code, verify against current docs:

| Source | Tool | What to check |
|--------|------|---------------|
| Phoenix Framework | Context7 MCP (`phoenixframework/phoenix`) | Router DSL, Controller, JSON rendering, Plug pipeline, `action_fallback` |
| Ecto | Context7 MCP (`elixir-ecto/ecto`) | Schema, Changeset, Repo, Query DSL, migrations, `Ecto.UUID` |
| Elixir stdlib | Context7 MCP (`elixir-lang/elixir`) | GenServer, Supervisor, Task, Registry, Application |
| Jason | Context7 MCP (`michalmuskala/jason`) | `@derive Jason.Encoder`, encoding options |

## Error Handling

- **Validation errors**: Return `{:error, changeset}` from context — controller uses `action_fallback` to render 422 with `Ecto.Changeset.traverse_errors/2`
- **Not found**: Return `{:error, :not_found}` from context — `FallbackController` maps to 404
- **Unexpected errors**: Let the process crash — the supervisor restarts it; log with `Logger.error/2` + metadata
- **JSON parse failure**: Phoenix renders 400 automatically on malformed JSON; validate shape with changeset before acting
- Never swallow errors with a bare `rescue` — every `rescue` block must log and either re-raise or return `{:error, reason}`
