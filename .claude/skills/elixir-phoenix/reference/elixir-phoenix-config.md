# Elixir + Phoenix Framework — Config Reference

## mix.exs

```elixir
defmodule MyApp.MixProject do
  use Mix.Project

  def project do
    [
      app: :my_app,
      version: "0.1.0",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      test_coverage: [tool: ExCoveralls],
      preferred_cli_env: [
        coveralls: :test,
        "coveralls.detail": :test,
        "coveralls.post": :test,
        "coveralls.html": :test
      ],
      dialyzer: [
        plt_file: {:no_warn, "priv/plts/dialyzer.plt"},
        flags: [:error_handling, :underspecs]
      ]
    ]
  end

  def application do
    [
      mod: {MyApp.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      # ── Web ─────────────────────────────────────────────────────
      {:phoenix, "~> 1.7"},
      {:phoenix_ecto, "~> 4.6"},
      {:plug_cowboy, "~> 2.7"},

      # ── Database ────────────────────────────────────────────────
      {:ecto_sql, "~> 3.12"},
      {:postgrex, "~> 0.19"},

      # ── JSON ────────────────────────────────────────────────────
      {:jason, "~> 1.4"},

      # ── Telemetry ───────────────────────────────────────────────
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.1"},

      # ── Dev / Test ──────────────────────────────────────────────
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false},
      {:excoveralls, "~> 0.18", only: :test},
      {:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false},

      # ── Test helpers ────────────────────────────────────────────
      {:phoenix_live_reload, "~> 1.5", only: :dev},
      {:ex_machina, "~> 2.8", only: :test}
    ]
  end

  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"]
    ]
  end
end
```

---

## config/config.exs

```elixir
import Config

config :my_app,
  ecto_repos: [MyApp.Repo]

config :my_app, MyAppWeb.Endpoint,
  url: [host: "localhost"],
  render_errors: [
    formats: [json: MyAppWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: MyApp.PubSub,
  live_view: [signing_salt: "changeme"]

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
```

---

## config/dev.exs

```elixir
import Config

config :my_app, MyApp.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "my_app_dev",
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :my_app, MyAppWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "local-dev-secret-key-base-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  watchers: []

config :logger, level: :debug

config :phoenix, :stacktrace_depth, 20
config :phoenix, :plug_init_mode, :runtime
```

---

## config/test.exs

```elixir
import Config

config :my_app, MyApp.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "my_app_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

config :my_app, MyAppWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "test-secret-key-base-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  server: false

config :logger, level: :warning
```

---

## config/runtime.exs

> Production secrets are NEVER compiled in. All values read at boot via `System.fetch_env!`.

```elixir
import Config

if config_env() == :prod do
  database_url =
    System.fetch_env!("DATABASE_URL")

  config :my_app, MyApp.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    ssl: true

  secret_key_base = System.fetch_env!("SECRET_KEY_BASE")

  config :my_app, MyAppWeb.Endpoint,
    http: [
      ip: {0, 0, 0, 0, 0, 0, 0, 0},
      port: String.to_integer(System.get_env("PORT") || "4000")
    ],
    secret_key_base: secret_key_base,
    url: [host: System.fetch_env!("PHX_HOST"), port: 443, scheme: "https"]
end
```

---

## .formatter.exs

```elixir
[
  import_deps: [:ecto, :ecto_sql, :phoenix],
  subdirectories: ["priv/*/migrations"],
  plugins: [Phoenix.LiveView.HTMLFormatter],
  inputs: ["*.{ex,exs}", "{config,lib,test}/**/*.{ex,exs}", "priv/*/seeds.exs"]
]
```

---

## .credo.exs

```elixir
%{
  configs: [
    %{
      name: "default",
      files: %{
        included: ["lib/", "test/"],
        excluded: [~r"/_build/", ~r"/deps/", ~r"/priv/"]
      },
      strict: true,
      checks: %{
        enabled: [
          {Credo.Check.Consistency.ExceptionNames, []},
          {Credo.Check.Consistency.LineEndings, []},
          {Credo.Check.Design.AliasUsage, [priority: :low, if_nested_deeper_than: 2]},
          {Credo.Check.Readability.MaxLineLength, [priority: :low, max_length: 120]},
          {Credo.Check.Refactor.Nesting, [max_nesting: 3]},
          {Credo.Check.Warning.UnusedEnumOperation, []},
          {Credo.Check.Warning.UnusedKeywordOperation, []},
          {Credo.Check.Warning.UnusedListOperation, []},
          {Credo.Check.Warning.UnusedStringOperation, []},
          {Credo.Check.Warning.UnusedTupleOperation, []}
        ],
        disabled: [
          # Allow IO.inspect during development; CI enforces removal
          {Credo.Check.Warning.IoInspect, []}
        ]
      }
    }
  ]
}
```

---

## Dockerfile

```dockerfile
# ── Build stage ───────────────────────────────────────────────
FROM hexpm/elixir:1.17.3-erlang-27.1-alpine-3.20.3 AS build

RUN apk add --no-cache build-base git

WORKDIR /app

ENV MIX_ENV=prod

RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile

COPY config config
COPY lib lib
COPY priv priv

RUN mix compile
RUN mix release

# ── Runtime stage ─────────────────────────────────────────────
FROM alpine:3.20.3 AS runtime

RUN apk add --no-cache libstdc++ openssl ncurses-libs

WORKDIR /app

COPY --from=build /app/_build/prod/rel/my_app ./

EXPOSE 4000

ENV PHX_HOST="localhost"
ENV PORT="4000"

ENTRYPOINT ["/app/bin/my_app"]
CMD ["start"]
```

---

## docker-compose.yml

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: my_app_dev
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5

  app:
    build: .
    ports:
      - "4000:4000"
    environment:
      DATABASE_URL: "ecto://postgres:postgres@db/my_app_prod"
      SECRET_KEY_BASE: "local-docker-secret-key-base-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxx"
      PHX_HOST: "localhost"
      PORT: "4000"
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/api/v1/health"]
      interval: 10s
      retries: 3
```

> Build: `docker-compose build`
> Run: `docker-compose up`
> Migrate (first run): `docker-compose run --rm app eval "MyApp.Release.migrate()"`
