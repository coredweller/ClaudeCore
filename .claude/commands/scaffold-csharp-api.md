---
description: Scaffold a new C# .NET 8 Web API application with ASP.NET Core, Dapper, FluentValidation, Serilog, and a sample endpoint
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs
disable-model-invocation: true
---

# Scaffold C# .NET 8 Web API Application

**Project name:** $ARGUMENTS (default to "MyApi" if not provided)

Delegate to the `csharp-dotnet-api` skill for all patterns, templates, and reference files.

## Pre-requisites

1. Read the `csharp-dotnet-api` skill (`SKILL.md` and all reference files) before writing any code.
2. Use Context7 MCP (`resolve-library-id` then `query-docs`) to verify ASP.NET Core, Dapper, and FluentValidation APIs before generating code. Key libraries: `dotnet/aspnetcore`, `DapperLib/Dapper`, `FluentValidation/FluentValidation`.
3. Verify modern C# 12 syntax (primary constructors, collection expressions, `required` properties) against Context7 — do NOT generate pre-C# 8 patterns (`new T()` without target-typing, non-nullable ignoring, sync-over-async).

## Steps

1. **Create solution and projects** — Scaffold the solution with two projects:
   ```bash
   dotnet new sln -n $ARGUMENTS
   dotnet new webapi -n $ARGUMENTS --use-controllers --no-openapi
   dotnet new xunit -n $ARGUMENTS.Tests
   dotnet sln add $ARGUMENTS/$ARGUMENTS.csproj
   dotnet sln add $ARGUMENTS.Tests/$ARGUMENTS.Tests.csproj
   dotnet add $ARGUMENTS.Tests reference $ARGUMENTS/$ARGUMENTS.csproj
   ```

2. **Configure project files** — Update `$ARGUMENTS.csproj` and `$ARGUMENTS.Tests.csproj` per skill config reference. Set `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`, `<Nullable>enable</Nullable>`, `<LangVersion>latest</LangVersion>`. Add `Directory.Build.props` to enforce these across both projects. Read `reference/csharp-dotnet-config.md` for exact NuGet versions.

3. **Add NuGet dependencies** — Add to API project: `Serilog.AspNetCore`, `Serilog.Sinks.Console`, `Dapper`, `Microsoft.Data.SqlClient`, `FluentValidation.AspNetCore`, `Swashbuckle.AspNetCore`. Add to test project: `NSubstitute`, `FluentAssertions`, `Microsoft.AspNetCore.Mvc.Testing`. Read `reference/csharp-dotnet-config.md` for exact package versions.

4. **Configure Program.cs** — Wire the full middleware pipeline:
   - Bootstrap Serilog before `WebApplication.CreateBuilder`
   - Register `AddControllers()`, `AddProblemDetails()`, `AddHealthChecks()`
   - Register `AddValidatorsFromAssemblyContaining<Program>()`
   - Register `IOptions<DatabaseOptions>` with `BindConfiguration` + `ValidateOnStart()`
   - Register `ITaskRepository` → `DapperTaskRepository` and `ITaskService` → `TaskService` as `Scoped`
   - Configure middleware order: `UseExceptionHandler()` → `UseSerilogRequestLogging()` → `UseHttpsRedirection()` → `UseAuthorization()` → `MapControllers()` → `MapHealthChecks("/api/v1/health")`
   - Wrap startup in try/catch to log fatal errors (exclude `HostAbortedException`)
   Read `reference/csharp-dotnet-config.md` for the full `Program.cs` template.

5. **Configure appsettings** — Create `appsettings.json` with Serilog config (minimum level overrides per namespace) and `Database` section with empty `ConnectionString`. Create `appsettings.Development.json` with `Debug` log level and local connection string. Read `reference/csharp-dotnet-config.md` for templates.

6. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to C# or general cross-cutting concerns like `code-standards.md`, `code-reviewer`, `security-reviewer`.

7. **Create Options class** — `Options/DatabaseOptions.cs` with `[Required]` `ConnectionString` property and `const string Section = "Database"`. Validated at startup via `ValidateDataAnnotations().ValidateOnStart()`.

8. **Create domain model** — Define a sample `Task` domain:
   - `readonly record struct TaskId(Guid Value)` with `New()`, `From(Guid)`, and `TryParse(string)` factory methods
   - `sealed class Task` with private constructor, `Create(string title)` factory, and `Reconstitute(...)` for persistence mapping
   - Sealed `TaskError` class hierarchy: `NotFound(TaskId Id)`, `ValidationError(string Message)`, `Conflict(string Message)`
   - `Result<T>` type with `Success(T)` / `Failure(TaskError)` statics and `Match<TOut>` method
   Read `reference/csharp-dotnet-templates.md` for templates.

9. **Create repository layer** — `ITaskRepository` interface with `async Task<T>` methods and `CancellationToken` on every signature. Implement `DapperTaskRepository` using `SqlConnection`, parameterised Dapper queries, and a private `sealed record` row DTO for mapping. Never expose the row DTO outside the repository class. Read `reference/csharp-dotnet-templates.md` for template.

10. **Create service layer** — `ITaskService` interface returning `Task<Result<T>>`. Implement `TaskService` with `ITaskRepository` and `ILogger<TaskService>` injected via primary constructor. All domain errors returned as `Result.Failure(...)` — never throw for domain outcomes. Pass `CancellationToken` through to every repository call. Read `reference/csharp-dotnet-templates.md` for template.

11. **Create controller** — `TasksController` with `[ApiController]`, `[Route("api/v1/tasks")]`, `[Produces("application/json")]`. All actions `async Task<IActionResult>` with `CancellationToken ct` parameter. Map `Result<T>` to HTTP via `switch` on `TaskError` — exhaustive, no wildcard catch-all except a logged 500 fallback. Use `CreatedAtAction` for POST. Read `reference/csharp-dotnet-templates.md` for template.

12. **Create validator** — `CreateTaskRequestValidator : AbstractValidator<CreateTaskRequest>` with `RuleFor(x => x.Title).NotEmpty().MaximumLength(200)`. Registered automatically via `AddValidatorsFromAssemblyContaining<Program>()` — no manual wiring needed.

13. **Add health endpoint** — Handled by `MapHealthChecks("/api/v1/health")` in `Program.cs`. No separate controller needed.

14. **Add .gitignore** — Add a `.gitignore` at the solution root covering: `bin/`, `obj/`, `*.user`, `.vs/`, `.vscode/`, `*.suo`, `launchSettings.json` (contains local secrets), `.env`, `*.nupkg`, `TestResults/`.

15. **Add Docker support** — Create a two-stage `Dockerfile`: `sdk:8.0` build stage (restore then publish `-c Release`) and `aspnet:8.0` runtime stage. Set `ASPNETCORE_URLS=http://+:8080`. Create `docker-compose.yml` with the app service and an `mssql/server:2022-latest` db service with health check. Read `reference/csharp-dotnet-config.md` for templates.

16. **Write tests** — Unit tests in `$ARGUMENTS.Tests/Services/TaskServiceTests.cs` using xUnit + NSubstitute + FluentAssertions with `NullLogger<TaskService>.Instance`. Cover:
    - `ListAllAsync` returns repository result
    - `GetByIdAsync` returns `Success` when task exists
    - `GetByIdAsync` returns `NotFound` error when task missing
    - `CreateAsync` with valid title returns created task and calls `SaveAsync`
    - `CreateAsync` with blank/null title returns `ValidationError` without calling `SaveAsync` (`[Theory]` + `[InlineData]`)
    - `DeleteAsync` returns `Success` when deleted
    - `DeleteAsync` returns `NotFound` error when not found
    Add integration test in `$ARGUMENTS.Tests/Controllers/TasksControllerIntegrationTests.cs` using `WebApplicationFactory<Program>`. Read `reference/csharp-dotnet-templates.md` for templates.

17. **Add `public partial class Program {}`** — Add this at the bottom of `Program.cs` so `WebApplicationFactory<Program>` in the test project can reference the entry point.

18. **Verify** — Run `dotnet build --warnaserror` (zero warnings required) then `dotnet test` (all green).

19. **Print summary** — List all created files, `dotnet run` to start (port 5000 HTTP / 5001 HTTPS), Swagger UI at `/swagger`, health check at `/api/v1/health`, next steps (swap `DapperTaskRepository` for real DB, add auth middleware, add EF Core migrations, etc.).
