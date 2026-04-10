---
description: Scaffold a new Elixir Phoenix Framework JSON API application with OTP supervision, Ecto, and a sample endpoint
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs
disable-model-invocation: true
---

# Scaffold Elixir + Phoenix Framework JSON API

**Project name:** $ARGUMENTS (default to "my_phoenix_app" if not provided)

Delegate to the `elixir-phoenix` skill for all patterns, templates, and reference files.

## Pre-requisites

1. Read the `elixir-phoenix` skill (`SKILL.md` and all reference files) before writing any code.
2. Use Context7 MCP (`resolve-library-id` then `query-docs`) to verify Phoenix and Ecto APIs before generating code. Key libraries: `phoenixframework/phoenix`, `elixir-ecto/ecto`, `elixir-lang/elixir`.
3. Verify Elixir idioms (pattern matching, `with`, `@spec`/`@type`, `@derive`, `@enforce_keys`) against Context7 — do NOT use deprecated Poison for JSON or legacy Phoenix 1.6 view patterns.

## Steps

1. **Create Mix project** — Run `mix phx.new <project_name> --no-assets --no-html --no-live --no-mailer --no-dashboard` to generate a JSON-only Phoenix project. Set `elixir: "~> 1.17"` in `mix.exs`.

2. **Configure dependencies** — Update `mix.exs` with: Phoenix ~> 1.7, Ecto SQL ~> 3.12, Postgrex ~> 0.19, Jason ~> 1.4, Credo ~> 1.7, Dialyxir ~> 1.4, ExCoveralls ~> 0.18, mix_audit ~> 2.1, ExMachina ~> 2.8. Read `reference/elixir-phoenix-config.md` for exact versions, aliases, and `dialyzer`/`test_coverage` project config.

3. **Set up OTP supervision tree** — Verify `lib/<app_name>/application.ex` declares children in the correct order: `Repo` first, then `Phoenix.PubSub`, then `Endpoint`. Strategy must be `:one_for_one`. Read `reference/elixir-phoenix-templates.md` for the `Application` template.

4. **Configure Phoenix** — Write `config/config.exs`, `config/dev.exs`, `config/test.exs`, and `config/runtime.exs`. Secrets (`SECRET_KEY_BASE`, `DATABASE_URL`) must live exclusively in `config/runtime.exs` using `System.fetch_env!` — never hardcoded in `config/config.exs` or compiled into a release. Read `reference/elixir-phoenix-config.md` for templates.

5. **Add formatter and Credo config** — Create `.formatter.exs` importing `:ecto`, `:ecto_sql`, `:phoenix` deps. Create `.credo.exs` with `strict: true` and `max_length: 120`. Read `reference/elixir-phoenix-config.md` for templates.

6. **Configure Claude** — Copy all items from `.claude` in this repository to the new project's `.claude` folder that are relevant to Elixir or general cross-cutting concerns: rules (`code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`), agents (`code-reviewer.md`, `architect.md`, `security-reviewer.md`, `postgresql-database-reviewer.md`, `dedup-code-agent.md`, `elixir-developer.md`), and skills folders (`elixir-phoenix/`, `database-schema-designer/`).

7. **Create domain schema** — Define a sample `Task` domain in `lib/<app_name>/tasks/task.ex`:
   - `use Ecto.Schema` with `@primary_key {:id, :binary_id, autogenerate: true}`
   - Fields: `title :string`, `timestamps(type: :utc_datetime)`
   - `@derive {Jason.Encoder, only: [:id, :title, :inserted_at]}`
   - `@type t :: %__MODULE__{...}` typespec
   - `changeset/2` with `cast/3`, `validate_required/2`, `validate_length/3`

8. **Create Ecto migration** — Generate with `mix ecto.gen.migration create_tasks`. Add `create table(:tasks, primary_key: false)` with `:binary_id` primary key, `title :string, null: false`, and `timestamps(type: :utc_datetime)`. Read `reference/elixir-phoenix-templates.md` for the migration template.

9. **Create context module** — `lib/<app_name>/tasks/tasks.ex` as the sole module that calls `Repo`. Implement: `list_tasks/0`, `get_task/1` → `{:ok, task}` or `{:error, :not_found}`, `create_task/1` → `{:ok, task}` or `{:error, changeset}`, `delete_task/1` → `{:ok, task}` or `{:error, :not_found}`. Add `@spec` to every public function. Read `reference/elixir-phoenix-templates.md` for the context template.

10. **Create FallbackController** — `lib/<app_name>_web/controllers/fallback_controller.ex`. Map `{:error, %Ecto.Changeset{}}` → 422 with `ChangesetJSON`, and `{:error, :not_found}` → 404 with `ErrorJSON`. This is the single place for error-to-HTTP translation. Read `reference/elixir-phoenix-templates.md`.

11. **Create TaskController** — `lib/<app_name>_web/controllers/task_controller.ex` with `action_fallback MyAppWeb.FallbackController`. Implement `index/2`, `show/2`, `create/2`, `delete/2`. Controllers must be thin: params → context call → render or `action_fallback`. Read `reference/elixir-phoenix-templates.md`.

12. **Create JSON views** — `task_json.ex` with `index/1` (list) and `show/1` (single). `changeset_json.ex` using `Ecto.Changeset.traverse_errors/2` for error messages. Read `reference/elixir-phoenix-templates.md`.

13. **Create health controller** — `HealthController.check/2` returning `json(conn, %{status: "ok", timestamp: DateTime.utc_now()})`.

14. **Register routes** — In `lib/<app_name>_web/router.ex` under `scope "/api/v1"` with `pipe_through :api`:
    ```
    get  "/health", HealthController, :check
    resources "/tasks", TaskController, only: [:index, :show, :create, :delete]
    ```

15. **Add Release module** — `lib/<app_name>/release.ex` with `migrate/0` and `rollback/2` functions for running Ecto migrations in a production release without Mix. Read `reference/elixir-phoenix-templates.md`.

16. **Add .gitignore** — Include standard Elixir/Phoenix ignores: `/_build/`, `/deps/`, `*.ez`, `/priv/static/assets/`, `erl_crash.dump`, `.elixir_ls/`, `priv/plts/` (Dialyzer PLTs), `.env`.

17. **Add Docker support** — Multi-stage `Dockerfile`: build stage uses `hexpm/elixir:1.17.3-erlang-27.1-alpine-3.20.3`, copies source, runs `mix release`; runtime stage uses `alpine:3.20.3` and copies the release. Add `docker-compose.yml` with `db` (postgres:16-alpine) and `app` services, `depends_on` with health check, and migration run instruction. Read `reference/elixir-phoenix-config.md` for templates.

18. **Write tests** — Create `test/support/data_case.ex` with Ecto sandbox setup (`async: true` safe). Write `test/<app_name>/tasks_test.exs` covering: list empty, list ordered, get found, get not found, create success, create missing title, create blank title, delete existing, delete not found. Read `reference/elixir-phoenix-templates.md` for templates.

19. **Verify** — Run `mix compile --warnings-as-errors` (zero warnings required), then `mix test` (all green), then `mix format --check-formatted`, then `mix credo --strict`.

20. **Print summary** — List all created files, `mix phx.server` to start, default port 4000, next steps (add auth via Guardian or phx_gen_auth, add Oban for background jobs, add LiveView for real-time UI, etc.).
