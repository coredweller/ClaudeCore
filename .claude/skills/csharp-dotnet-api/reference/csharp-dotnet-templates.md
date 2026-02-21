# C# .NET 8 Web API — Code Templates

## Directory Layout

```
MyApi/
├── Controllers/
│   ├── TasksController.cs
│   └── HealthController.cs        # Handled by MapHealthChecks in Program.cs
├── Domain/
│   ├── Task.cs                    # Aggregate root + strongly-typed ID
│   └── TaskError.cs               # Sealed error hierarchy
├── Services/
│   ├── ITaskService.cs
│   └── TaskService.cs
├── Repositories/
│   ├── ITaskRepository.cs
│   └── DapperTaskRepository.cs
├── Middleware/
│   └── ExceptionMiddleware.cs     # Fallback — prefer UseExceptionHandler()
├── Validators/
│   └── CreateTaskRequestValidator.cs
└── Options/
    └── DatabaseOptions.cs
MyApi.Tests/
└── Services/
    └── TaskServiceTests.cs
```

---

## Domain Model — `Domain/Task.cs`

```csharp
namespace MyApi.Domain;

// ── Strongly-typed ID — zero boxing, cannot be confused with other Guid IDs ──
public readonly record struct TaskId(Guid Value)
{
    public static TaskId New() => new(Guid.NewGuid());
    public static TaskId From(Guid value) => new(value);

    public static bool TryParse(string input, out TaskId result)
    {
        if (Guid.TryParse(input, out var guid))
        {
            result = new TaskId(guid);
            return true;
        }
        result = default;
        return false;
    }

    public override string ToString() => Value.ToString();
}

// ── Aggregate root ────────────────────────────────────────────────────────────
public sealed class Task
{
    public TaskId    Id        { get; }
    public string    Title     { get; private set; }
    public DateTime  CreatedAt { get; }

    private Task(TaskId id, string title, DateTime createdAt)
    {
        Id        = id;
        Title     = title;
        CreatedAt = createdAt;
    }

    // Factory — only valid Tasks can be constructed
    public static Task Create(string title) =>
        new(TaskId.New(), title.Trim(), DateTime.UtcNow);

    // Reconstitute from persistence
    public static Task Reconstitute(TaskId id, string title, DateTime createdAt) =>
        new(id, title, createdAt);
}
```

---

## Domain Error — `Domain/TaskError.cs`

```csharp
namespace MyApi.Domain;

// Sealed hierarchy — controllers switch-exhaust these; no magic strings or codes.
public abstract class TaskError
{
    private TaskError() { }   // Only nested subclasses allowed

    public sealed class NotFound(TaskId Id) : TaskError;
    public sealed class ValidationError(string Message) : TaskError;
    public sealed class Conflict(string Message) : TaskError;
}
```

---

## Result Type — `Domain/Result.cs`

```csharp
namespace MyApi.Domain;

// Minimal Result<T> — keeps service signatures honest without a third-party library.
public sealed class Result<T>
{
    private readonly T?          _value;
    private readonly TaskError?  _error;

    private Result(T value)           { _value = value; IsSuccess = true; }
    private Result(TaskError error)   { _error = error; IsSuccess = false; }

    public bool       IsSuccess { get; }
    public bool       IsFailure => !IsSuccess;

    public T          Value => IsSuccess ? _value! : throw new InvalidOperationException("Result is a failure.");
    public TaskError  Error => IsFailure ? _error! : throw new InvalidOperationException("Result is a success.");

    public static Result<T> Success(T value)         => new(value);
    public static Result<T> Failure(TaskError error) => new(error);

    // Pattern-match helper
    public TOut Match<TOut>(Func<T, TOut> onSuccess, Func<TaskError, TOut> onFailure) =>
        IsSuccess ? onSuccess(_value!) : onFailure(_error!);
}
```

> For richer Result semantics (railway-oriented, `Bind`, `Map`) use the
> `ErrorOr` or `OneOf` NuGet package. The above is zero-dependency and sufficient
> for straightforward APIs.

---

## Repository Interface — `Repositories/ITaskRepository.cs`

```csharp
using MyApi.Domain;

namespace MyApi.Repositories;

public interface ITaskRepository
{
    Task<IReadOnlyList<Domain.Task>> GetAllAsync(CancellationToken ct = default);
    Task<Domain.Task?> GetByIdAsync(TaskId id, CancellationToken ct = default);
    Task<Domain.Task>  SaveAsync(Domain.Task task, CancellationToken ct = default);
    Task<bool>         DeleteAsync(TaskId id, CancellationToken ct = default);
}
```

## Dapper Repository — `Repositories/DapperTaskRepository.cs`

```csharp
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using MyApi.Domain;
using MyApi.Options;

namespace MyApi.Repositories;

public sealed class DapperTaskRepository(IOptions<DatabaseOptions> dbOptions, ILogger<DapperTaskRepository> logger)
    : ITaskRepository
{
    private readonly string _connectionString = dbOptions.Value.ConnectionString;

    public async Task<IReadOnlyList<Domain.Task>> GetAllAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT Id, Title, CreatedAt FROM Tasks ORDER BY CreatedAt DESC";
        await using var conn = new SqlConnection(_connectionString);

        logger.LogDebug("Fetching all tasks");
        var rows = await conn.QueryAsync<TaskRow>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.Select(Map).ToList();
    }

    public async Task<Domain.Task?> GetByIdAsync(TaskId id, CancellationToken ct = default)
    {
        const string sql = "SELECT Id, Title, CreatedAt FROM Tasks WHERE Id = @Id";
        await using var conn = new SqlConnection(_connectionString);

        var row = await conn.QuerySingleOrDefaultAsync<TaskRow>(
            new CommandDefinition(sql, new { Id = id.Value }, cancellationToken: ct));

        return row is null ? null : Map(row);
    }

    public async Task<Domain.Task> SaveAsync(Domain.Task task, CancellationToken ct = default)
    {
        const string sql = """
            INSERT INTO Tasks (Id, Title, CreatedAt)
            VALUES (@Id, @Title, @CreatedAt)
            """;
        await using var conn = new SqlConnection(_connectionString);

        logger.LogDebug("Saving task {TaskId}", task.Id);
        await conn.ExecuteAsync(new CommandDefinition(
            sql,
            new { Id = task.Id.Value, task.Title, task.CreatedAt },
            cancellationToken: ct));

        return task;
    }

    public async Task<bool> DeleteAsync(TaskId id, CancellationToken ct = default)
    {
        const string sql = "DELETE FROM Tasks WHERE Id = @Id";
        await using var conn = new SqlConnection(_connectionString);

        var affected = await conn.ExecuteAsync(
            new CommandDefinition(sql, new { Id = id.Value }, cancellationToken: ct));

        return affected > 0;
    }

    private static Domain.Task Map(TaskRow r) =>
        Domain.Task.Reconstitute(TaskId.From(r.Id), r.Title, r.CreatedAt);

    // Private DTO — maps to DB columns, never exposed outside this class
    private sealed record TaskRow(Guid Id, string Title, DateTime CreatedAt);
}
```

---

## Service Interface — `Services/ITaskService.cs`

```csharp
using MyApi.Domain;

namespace MyApi.Services;

public interface ITaskService
{
    Task<IReadOnlyList<Domain.Task>>  ListAllAsync(CancellationToken ct = default);
    Task<Result<Domain.Task>>         GetByIdAsync(TaskId id, CancellationToken ct = default);
    Task<Result<Domain.Task>>         CreateAsync(string title, CancellationToken ct = default);
    Task<Result<bool>>                DeleteAsync(TaskId id, CancellationToken ct = default);
}
```

## Service — `Services/TaskService.cs`

```csharp
using MyApi.Domain;
using MyApi.Repositories;

namespace MyApi.Services;

public sealed class TaskService(ITaskRepository repository, ILogger<TaskService> logger)
    : ITaskService
{
    public async Task<IReadOnlyList<Domain.Task>> ListAllAsync(CancellationToken ct = default)
    {
        logger.LogDebug("Listing all tasks");
        return await repository.GetAllAsync(ct);
    }

    public async Task<Result<Domain.Task>> GetByIdAsync(TaskId id, CancellationToken ct = default)
    {
        var task = await repository.GetByIdAsync(id, ct);

        if (task is null)
        {
            logger.LogWarning("Task {TaskId} not found", id);
            return Result<Domain.Task>.Failure(new TaskError.NotFound(id));
        }

        return Result<Domain.Task>.Success(task);
    }

    public async Task<Result<Domain.Task>> CreateAsync(string title, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(title))
            return Result<Domain.Task>.Failure(new TaskError.ValidationError("Title must not be blank."));

        var task = Domain.Task.Create(title);
        await repository.SaveAsync(task, ct);

        logger.LogInformation("Created task {TaskId} with title '{Title}'", task.Id, task.Title);
        return Result<Domain.Task>.Success(task);
    }

    public async Task<Result<bool>> DeleteAsync(TaskId id, CancellationToken ct = default)
    {
        var deleted = await repository.DeleteAsync(id, ct);

        if (!deleted)
        {
            logger.LogWarning("Delete failed — task {TaskId} not found", id);
            return Result<bool>.Failure(new TaskError.NotFound(id));
        }

        logger.LogInformation("Deleted task {TaskId}", id);
        return Result<bool>.Success(true);
    }
}
```

> **Never throw** from services for domain errors. Let `ExceptionHandlerMiddleware`
> handle genuine unexpected exceptions — the service only knows about domain outcomes.

---

## Controller — `Controllers/TasksController.cs`

```csharp
using Microsoft.AspNetCore.Mvc;
using MyApi.Domain;
using MyApi.Services;

namespace MyApi.Controllers;

[ApiController]
[Route("api/v1/tasks")]
[Produces("application/json")]
public sealed class TasksController(ITaskService service, ILogger<TasksController> logger)
    : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<Domain.Task>>(StatusCodes.Status200OK)]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await service.ListAllAsync(ct));

    [HttpGet("{id:guid}")]
    [ProducesResponseType<Domain.Task>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var result = await service.GetByIdAsync(TaskId.From(id), ct);
        return MapResult(result);
    }

    [HttpPost]
    [ProducesResponseType<Domain.Task>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] CreateTaskRequest request, CancellationToken ct)
    {
        var result = await service.CreateAsync(request.Title, ct);
        return result.Match(
            onSuccess: task => CreatedAtAction(nameof(GetById), new { id = task.Id.Value }, task),
            onFailure: MapError);
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var result = await service.DeleteAsync(TaskId.From(id), ct);
        return result.Match(
            onSuccess: _ => (IActionResult)NoContent(),
            onFailure: MapError);
    }

    // ── Result → HTTP mapping ───────────────────────────────────────────────
    private IActionResult MapResult<T>(Result<T> result) =>
        result.Match(onSuccess: Ok, onFailure: MapError);

    private IActionResult MapError(TaskError error) => error switch
    {
        TaskError.NotFound e        => NotFound(ProblemFor(404, $"Task {e.Id} not found.")),
        TaskError.ValidationError e => BadRequest(ProblemFor(400, e.Message)),
        TaskError.Conflict e        => Conflict(ProblemFor(409, e.Message)),
        _                           => StatusCode(500, ProblemFor(500, "Unexpected error."))
    };

    private ProblemDetails ProblemFor(int status, string detail) => new()
    {
        Status = status,
        Detail = detail,
        Instance = HttpContext.Request.Path
    };
}

// ── Request DTO ──────────────────────────────────────────────────────────────
public sealed record CreateTaskRequest(string Title);
```

---

## Validator — `Validators/CreateTaskRequestValidator.cs`

```csharp
using FluentValidation;
using MyApi.Controllers;

namespace MyApi.Validators;

public sealed class CreateTaskRequestValidator : AbstractValidator<CreateTaskRequest>
{
    public CreateTaskRequestValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty()
                .WithMessage("Title is required.")
            .MaximumLength(200)
                .WithMessage("Title must not exceed 200 characters.");
    }
}
```

> `[ApiController]` automatically runs validators registered with DI and returns
> 400 with a `ValidationProblemDetails` body before the action executes.
> No manual `ModelState.IsValid` checks needed.

---

## Exception Middleware — `Middleware/ExceptionMiddleware.cs`

```csharp
namespace MyApi.Middleware;

// Use this only as a fallback if UseExceptionHandler() + IProblemDetailsService
// doesn't fit your pipeline. Prefer the built-in middleware from Program.cs.
public sealed class ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unhandled exception on {Method} {Path}",
                context.Request.Method, context.Request.Path);

            context.Response.StatusCode  = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";

            var problem = new ProblemDetails
            {
                Status   = 500,
                Title    = "An unexpected error occurred.",
                Instance = context.Request.Path
            };

            await context.Response.WriteAsJsonAsync(problem, context.RequestAborted);
        }
    }
}
```

---

## Tests — `MyApi.Tests/Services/TaskServiceTests.cs`

```csharp
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using MyApi.Domain;
using MyApi.Repositories;
using MyApi.Services;
using NSubstitute;
using NSubstitute.ReturnsExtensions;

namespace MyApi.Tests.Services;

public sealed class TaskServiceTests
{
    private readonly ITaskRepository _repository = Substitute.For<ITaskRepository>();
    private readonly TaskService     _sut;

    public TaskServiceTests()
    {
        _sut = new TaskService(_repository, NullLogger<TaskService>.Instance);
    }

    // ── ListAllAsync ────────────────────────────────────────────────────────
    [Fact]
    public async Task ListAllAsync_WhenCalled_ReturnsRepositoryResult()
    {
        var tasks = new[] { Domain.Task.Create("Buy milk") };
        _repository.GetAllAsync().Returns(tasks);

        var result = await _sut.ListAllAsync();

        result.Should().BeEquivalentTo(tasks);
    }

    // ── GetByIdAsync ────────────────────────────────────────────────────────
    [Fact]
    public async Task GetByIdAsync_WhenTaskExists_ReturnsSuccess()
    {
        var task = Domain.Task.Create("Buy milk");
        _repository.GetByIdAsync(task.Id).Returns(task);

        var result = await _sut.GetByIdAsync(task.Id);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be(task);
    }

    // ── CreateAsync ─────────────────────────────────────────────────────────
    [Fact]
    public async Task CreateAsync_WithValidTitle_ReturnsCreatedTask()
    {
        _repository.SaveAsync(Arg.Any<Domain.Task>())
                   .Returns(callInfo => callInfo.Arg<Domain.Task>());

        var result = await _sut.CreateAsync("Walk the dog");

        result.IsSuccess.Should().BeTrue();
        result.Value.Title.Should().Be("Walk the dog");
        await _repository.Received(1).SaveAsync(Arg.Is<Domain.Task>(t => t.Title == "Walk the dog"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task CreateAsync_WithBlankTitle_ReturnsValidationError(string? title)
    {
        var result = await _sut.CreateAsync(title!);

        result.IsFailure.Should().BeTrue();
        result.Error.Should().BeOfType<TaskError.ValidationError>();
        await _repository.DidNotReceive().SaveAsync(Arg.Any<Domain.Task>());
    }

    // ── DeleteAsync ─────────────────────────────────────────────────────────
    [Fact]
    public async Task DeleteAsync_WhenTaskExists_ReturnsSuccess()
    {
        var id = TaskId.New();
        _repository.DeleteAsync(id).Returns(true);

        var result = await _sut.DeleteAsync(id);

        result.IsSuccess.Should().BeTrue();
    }
}
```

> `NullLogger<T>.Instance` avoids mocking the logger — logging is a side effect,
> not a domain concern, so tests shouldn't assert on it unless you're testing an
> auditing/observability feature specifically.

---

## Integration Test — `MyApi.Tests/Controllers/TasksControllerIntegrationTests.cs`

```csharp
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using MyApi.Controllers;
using MyApi.Domain;

namespace MyApi.Tests.Controllers;

public sealed class TasksControllerIntegrationTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Post_WithValidTitle_Returns201AndCreatedTask()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/tasks", new CreateTaskRequest("Buy milk"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var task = await response.Content.ReadFromJsonAsync<Domain.Task>();
        task!.Title.Should().Be("Buy milk");
    }

    [Fact]
    public async Task Post_WithEmptyTitle_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/tasks", new CreateTaskRequest(""));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Get_UnknownId_Returns404()
    {
        var response = await _client.GetAsync($"/api/v1/tasks/{Guid.NewGuid()}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
```

> `WebApplicationFactory<Program>` spins up the full ASP.NET Core pipeline in-process —
> no real HTTP traffic, no port binding. Make `Program` accessible to the test project
> by adding `<InternalsVisibleTo Include="MyApi.Tests" />` to the `.csproj` or by
> adding a `public partial class Program {}` at the bottom of `Program.cs`.
