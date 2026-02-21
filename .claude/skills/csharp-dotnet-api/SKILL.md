---
name: csharp-dotnet-api
description: Skill for C# .NET 8 Web API applications with ASP.NET Core, strongly-typed domain IDs, Result pattern, and clean layered architecture. Activate when creating controllers, services, repositories, domain models, or tests.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# C# .NET 8 Web API Skill

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| API style | Controllers (`[ApiController]`) | Explicit routing, model binding, filter pipeline |
| Error handling | `Result<T>` + ProblemDetails middleware | No exception-driven flow control; consistent RFC 7807 responses |
| DI | ASP.NET Core built-in container | Zero overhead, no third-party DI needed |
| async | `async`/`await` throughout — no `.Result` or `.Wait()` | Avoids deadlocks, maximises thread-pool efficiency |
| Domain IDs | `readonly record struct` wrapping `Guid` | Zero-cost, type-safe, no accidental ID confusion |
| Domain errors | `sealed` class hierarchy with `switch` | Pattern-matchable, exhaustive, no magic strings |
| Validation | FluentValidation + `[ApiController]` auto-400 | Declarative rules, separates validation from logic |
| Logging | Serilog with structured sinks | JSON output, enrichers, compatible with ELK/Seq |
| Testing | xUnit + NSubstitute + FluentAssertions | Fast, expressive, no boilerplate mocks |
| ORM | Dapper (raw SQL) | Explicit queries, no N+1 surprises, performant |

## Process

1. Read `reference/csharp-dotnet-config.md` — exact `.csproj`, `Program.cs`, `appsettings.json`, `Dockerfile`
2. Read `reference/csharp-dotnet-templates.md` — Domain, Repository, Service, Controller, Middleware, Test templates
3. Scaffold DI registration in `Program.cs` **first** — every other layer depends on it compiling
4. Use `async`/`await` for ALL I/O; never block with `.Result`, `.Wait()`, or `Task.Run()` to sync
5. Return `Result<T>` from services; map to HTTP responses in controllers only — never throw for domain errors
6. Run `dotnet build --warnaserror && dotnet test` before finishing

## Common Commands

```bash
dotnet new webapi -n MyApi --use-controllers   # Create project with controllers
dotnet run                                      # Start dev server (port 5000/5001)
dotnet watch run                                # Watch mode with hot reload
dotnet test                                     # Run all tests
dotnet test --logger trx                        # Test with TRX report
dotnet build --warnaserror                      # Treat warnings as errors
dotnet format                                   # Format all sources (Roslyn-based)
dotnet publish -c Release -o out               # Build release artifact
dotnet ef migrations add <Name>                 # Add EF Core migration (if using EF)
```

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| Domain IDs | `readonly record struct TaskId(Guid Value)` |
| Domain errors | `sealed class TaskError` + subclasses, matched via `switch` |
| Service return | `Task<Result<T>>` — never throws for domain errors |
| Result mapping | Controller `switch` on `Result` → `Ok` / `NotFound` / `BadRequest` |
| Async all the way | `async Task<IActionResult>` controller actions |
| Repository | Interface + Dapper implementation, returns `Task<T?>` |
| Validation | `AbstractValidator<TRequest>` registered with DI |
| Config binding | `IOptions<T>` with `services.AddOptions<T>().BindConfiguration(section)` |
| Logging | `ILogger<T>` injected — structured params, never string interpolation |
| Error middleware | `UseExceptionHandler` + `IProblemDetailsService` for RFC 7807 |

## Reference Files

| File | Content |
|------|---------|
| `reference/csharp-dotnet-config.md` | `.csproj`, `Program.cs`, `appsettings.json`, `Dockerfile`, `docker-compose.yml` |
| `reference/csharp-dotnet-templates.md` | Domain, Repository, Service, Controller, Middleware, Validator, Test templates |

## Documentation Sources

Before generating code, verify against current docs:

| Source | Tool | What to check |
|--------|------|---------------|
| ASP.NET Core | Context7 MCP (`dotnet/aspnetcore`) | Controller attributes, middleware pipeline, `IActionResult`, minimal APIs |
| .NET BCL | Context7 MCP (`dotnet/dotnet`) | `Task`, `CancellationToken`, `ILogger`, `IOptions` |
| Dapper | Context7 MCP (`DapperLib/Dapper`) | `QueryAsync`, `ExecuteAsync`, parameter binding |
| FluentValidation | Context7 MCP (`FluentValidation/FluentValidation`) | `AbstractValidator`, `RuleFor`, async validators |
| Serilog | Context7 MCP (`serilog/serilog`) | Sinks, enrichers, `Log.ForContext` |
| NSubstitute | Context7 MCP (`nsubstitute/NSubstitute`) | `Substitute.For`, `Returns`, `Received` |

## Error Handling

- **Domain errors** (not found, validation): Return `Result.Failure(error)` from service — controller maps to 4xx
- **Unexpected exceptions**: Let them propagate to `ExceptionHandlerMiddleware` → 500 ProblemDetails
- **Validation failures**: FluentValidation + `[ApiController]` auto-returns 400 with field errors
- **Never** catch and swallow: every `catch` must log and rethrow or return an error result
- **Never** use exceptions for flow control (e.g. `throw new NotFoundException(...)` from service)
- `CancellationToken` must be threaded through every async call to support request cancellation
