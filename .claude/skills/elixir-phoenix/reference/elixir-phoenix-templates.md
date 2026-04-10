# Elixir + Phoenix Framework — Code Templates

## Directory Layout

```
lib/
├── my_app/
│   ├── application.ex              # OTP Application + supervision tree
│   ├── repo.ex                     # Ecto Repo
│   └── tasks/
│       ├── task.ex                 # Ecto schema + changeset (domain model)
│       └── tasks.ex                # Context module (business logic)
├── my_app_web/
│   ├── endpoint.ex                 # Plug pipeline
│   ├── router.ex                   # Route definitions
│   └── controllers/
│       ├── task_controller.ex
│       ├── health_controller.ex
│       ├── fallback_controller.ex  # Centralised error → HTTP mapping
│       └── error_json.ex           # Error shape renderer
config/
├── config.exs                      # Base config (env-agnostic)
├── dev.exs                         # Dev overrides
├── test.exs                        # Test overrides
└── runtime.exs                     # Production secrets (System.fetch_env!)
priv/
└── repo/
    └── migrations/
        └── 20240101000000_create_tasks.exs
test/
├── support/
│   ├── conn_case.ex                # Controller test helper
│   ├── data_case.ex                # Ecto sandbox helper
│   └── factory.ex                  # ExMachina factories
└── my_app/
    └── tasks_test.exs
```

---

## Domain Schema — `lib/my_app/tasks/task.ex`

```elixir
defmodule MyApp.Tasks.Task do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  # Derive JSON encoding — list only the fields you want exposed
  @derive {Jason.Encoder, only: [:id, :title, :inserted_at]}

  schema "tasks" do
    field :title, :string

    timestamps(type: :utc_datetime)
  end

  @type t :: %__MODULE__{
          id: Ecto.UUID.t() | nil,
          title: String.t() | nil,
          inserted_at: DateTime.t() | nil,
          updated_at: DateTime.t() | nil
        }

  @doc """
  Changeset for creating or updating a task.
  """
  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(task, attrs) do
    task
    |> cast(attrs, [:title])
    |> validate_required([:title])
    |> validate_length(:title, min: 1, max: 255)
  end
end
```

---

## Migration — `priv/repo/migrations/20240101000000_create_tasks.exs`

```elixir
defmodule MyApp.Repo.Migrations.CreateTasks do
  use Ecto.Migration

  def change do
    create table(:tasks, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :title, :string, null: false

      timestamps(type: :utc_datetime)
    end
  end
end
```

---

## Context — `lib/my_app/tasks/tasks.ex`

> The context is the only module that may call `MyApp.Repo` directly.
> Controllers and other contexts must go through this public API.

```elixir
defmodule MyApp.Tasks do
  @moduledoc """
  Boundary for the Tasks domain. All task operations go through here.
  """

  import Ecto.Query, warn: false

  alias MyApp.Repo
  alias MyApp.Tasks.Task

  @type task_error :: {:error, Ecto.Changeset.t()} | {:error, :not_found}

  @doc "Returns all tasks ordered by insertion time."
  @spec list_tasks() :: [Task.t()]
  def list_tasks do
    Task
    |> order_by([t], asc: t.inserted_at)
    |> Repo.all()
  end

  @doc "Returns a single task by ID, or `{:error, :not_found}`."
  @spec get_task(Ecto.UUID.t()) :: {:ok, Task.t()} | {:error, :not_found}
  def get_task(id) do
    case Repo.get(Task, id) do
      nil  -> {:error, :not_found}
      task -> {:ok, task}
    end
  end

  @doc "Creates a task. Returns `{:ok, task}` or `{:error, changeset}`."
  @spec create_task(map()) :: {:ok, Task.t()} | task_error()
  def create_task(attrs) do
    %Task{}
    |> Task.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Deletes a task by ID. Returns `{:ok, task}` or `{:error, :not_found}`."
  @spec delete_task(Ecto.UUID.t()) :: {:ok, Task.t()} | {:error, :not_found}
  def delete_task(id) do
    with {:ok, task} <- get_task(id) do
      Repo.delete(task)
    end
  end
end
```

---

## Controller — `lib/my_app_web/controllers/task_controller.ex`

```elixir
defmodule MyAppWeb.TaskController do
  use MyAppWeb, :controller

  alias MyApp.Tasks
  alias MyApp.Tasks.Task

  action_fallback MyAppWeb.FallbackController

  @doc false
  def index(conn, _params) do
    tasks = Tasks.list_tasks()
    render(conn, :index, tasks: tasks)
  end

  @doc false
  def show(conn, %{"id" => id}) do
    with {:ok, %Task{} = task} <- Tasks.get_task(id) do
      render(conn, :show, task: task)
    end
  end

  @doc false
  def create(conn, %{"task" => task_params}) do
    with {:ok, %Task{} = task} <- Tasks.create_task(task_params) do
      conn
      |> put_status(:created)
      |> render(:show, task: task)
    end
  end

  @doc false
  def delete(conn, %{"id" => id}) do
    with {:ok, %Task{}} <- Tasks.delete_task(id) do
      send_resp(conn, :no_content, "")
    end
  end
end
```

> `action_fallback` passes any `{:error, reason}` returned by `with` to `FallbackController`.
> This keeps all error-to-HTTP mapping in one place.

---

## JSON View — `lib/my_app_web/controllers/task_json.ex`

```elixir
defmodule MyAppWeb.TaskJSON do
  alias MyApp.Tasks.Task

  @doc "Renders a list of tasks."
  def index(%{tasks: tasks}), do: %{data: Enum.map(tasks, &data/1)}

  @doc "Renders a single task."
  def show(%{task: task}), do: %{data: data(task)}

  defp data(%Task{} = task) do
    %{
      id: task.id,
      title: task.title,
      inserted_at: task.inserted_at
    }
  end
end
```

---

## Fallback Controller — `lib/my_app_web/controllers/fallback_controller.ex`

```elixir
defmodule MyAppWeb.FallbackController do
  @moduledoc """
  Translates controller action errors into well-formed JSON responses.
  All `with` arms in controllers that return `{:error, reason}` land here.
  """

  use MyAppWeb, :controller

  # Ecto changeset validation failure → 422 Unprocessable Entity
  def call(conn, {:error, %Ecto.Changeset{} = changeset}) do
    conn
    |> put_status(:unprocessable_entity)
    |> put_view(json: MyAppWeb.ChangesetJSON)
    |> render(:error, changeset: changeset)
  end

  # Resource not found → 404
  def call(conn, {:error, :not_found}) do
    conn
    |> put_status(:not_found)
    |> put_view(json: MyAppWeb.ErrorJSON)
    |> render(:"404")
  end
end
```

---

## Changeset Error View — `lib/my_app_web/controllers/changeset_json.ex`

```elixir
defmodule MyAppWeb.ChangesetJSON do
  @doc "Renders changeset errors as a map of field → [messages]."
  def error(%{changeset: changeset}) do
    %{errors: translate_errors(changeset)}
  end

  defp translate_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
```

---

## Health Controller — `lib/my_app_web/controllers/health_controller.ex`

```elixir
defmodule MyAppWeb.HealthController do
  use MyAppWeb, :controller

  def check(conn, _params) do
    json(conn, %{status: "ok", timestamp: DateTime.utc_now()})
  end
end
```

---

## Router — `lib/my_app_web/router.ex`

```elixir
defmodule MyAppWeb.Router do
  use MyAppWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api/v1", MyAppWeb do
    pipe_through :api

    get "/health", HealthController, :check

    resources "/tasks", TaskController, only: [:index, :show, :create, :delete]
  end
end
```

---

## Application Supervisor — `lib/my_app/application.ex`

```elixir
defmodule MyApp.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Database connection pool — always start before web
      MyApp.Repo,

      # Telemetry
      MyAppWeb.Telemetry,

      # PubSub for LiveView (keep even in JSON-only apps — Phoenix requires it)
      {Phoenix.PubSub, name: MyApp.PubSub},

      # HTTP endpoint — start last
      MyAppWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: MyApp.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Called by `mix release` to tell Phoenix the endpoint config
  @impl true
  def config_change(changed, _new, removed) do
    MyAppWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
```

> **Order matters.** Database must be supervised before the endpoint attempts queries at startup.
> The `:one_for_one` strategy means a crashed child restarts independently without affecting siblings.

---

## Repo — `lib/my_app/repo.ex`

```elixir
defmodule MyApp.Repo do
  use Ecto.Repo,
    otp_app: :my_app,
    adapter: Ecto.Adapters.Postgres
end
```

---

## Release Module — `lib/my_app/release.ex`

> Used by `docker-compose run --rm app eval "MyApp.Release.migrate()"` in production.

```elixir
defmodule MyApp.Release do
  @app :my_app

  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
  end

  defp repos, do: Application.fetch_env!(@app, :ecto_repos)

  defp load_app, do: Application.load(@app)
end
```

---

## Test Support — `test/support/data_case.ex`

```elixir
defmodule MyApp.DataCase do
  @moduledoc """
  Base case for context tests. Wraps each test in an Ecto sandbox transaction
  that is rolled back on exit — no test data leaks between cases.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      alias MyApp.Repo
      import Ecto.Changeset
      import MyApp.DataCase
    end
  end

  setup tags do
    MyApp.DataCase.setup_sandbox(tags)
    :ok
  end

  def setup_sandbox(tags) do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(MyApp.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
  end
end
```

---

## Test — `test/my_app/tasks_test.exs`

```elixir
defmodule MyApp.TasksTest do
  use MyApp.DataCase, async: true

  alias MyApp.Tasks
  alias MyApp.Tasks.Task

  describe "list_tasks/0" do
    test "returns empty list when no tasks exist" do
      assert Tasks.list_tasks() == []
    end

    test "returns all tasks ordered by insertion time" do
      {:ok, first}  = Tasks.create_task(%{"title" => "First"})
      {:ok, second} = Tasks.create_task(%{"title" => "Second"})

      assert [^first, ^second] = Tasks.list_tasks()
    end
  end

  describe "get_task/1" do
    test "returns {:ok, task} for existing ID" do
      {:ok, task} = Tasks.create_task(%{"title" => "Buy milk"})
      assert {:ok, ^task} = Tasks.get_task(task.id)
    end

    test "returns {:error, :not_found} for unknown ID" do
      assert {:error, :not_found} = Tasks.get_task(Ecto.UUID.generate())
    end
  end

  describe "create_task/1" do
    test "creates a task with valid attrs" do
      assert {:ok, %Task{} = task} = Tasks.create_task(%{"title" => "Walk the dog"})
      assert task.title == "Walk the dog"
      assert task.id != nil
    end

    test "returns {:error, changeset} when title is missing" do
      assert {:error, changeset} = Tasks.create_task(%{})
      assert %{title: ["can't be blank"]} = errors_on(changeset)
    end

    test "returns {:error, changeset} when title is blank" do
      assert {:error, changeset} = Tasks.create_task(%{"title" => "   "})
      assert %{title: ["can't be blank"]} = errors_on(changeset)
    end
  end

  describe "delete_task/1" do
    test "deletes existing task" do
      {:ok, task} = Tasks.create_task(%{"title" => "To delete"})
      assert {:ok, %Task{}} = Tasks.delete_task(task.id)
      assert {:error, :not_found} = Tasks.get_task(task.id)
    end

    test "returns {:error, :not_found} for unknown ID" do
      assert {:error, :not_found} = Tasks.delete_task(Ecto.UUID.generate())
    end
  end

  # Helper: flattens changeset errors to %{field: [messages]}
  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
```

> `async: true` is safe because `DataCase` uses `Ecto.Adapters.SQL.Sandbox`.
> Each test runs in an isolated transaction — no shared state between parallel tests.
