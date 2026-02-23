# C# .NET 8 Web API — Code Templates

## Directory Layout

```
MyApi/
├── Controllers/
│   ├── WorkItemsController.cs
│   └── HealthController.cs        # Handled by MapHealthChecks in Program.cs
├── Domain/
│   ├── WorkItem.cs                # Aggregate root + strongly-typed ID
│   └── WorkItemError.cs           # Abstract record error hierarchy
├── Services/
│   ├── IWorkItemService.cs
│   └── WorkItemService.cs
├── Repositories/
│   ├── IWorkItemRepository.cs
│   └── DapperWorkItemRepository.cs
├── Middleware/
│   └── ExceptionMiddleware.cs     # Fallback — prefer UseExceptionHandler()
├── Validators/
│   └── CreateWorkItemRequestValidator.cs
└── Options/
    └── DatabaseOptions.cs
MyApi.Tests/
├── Services/
│   └── WorkItemServiceTests.cs
└── Controllers/
    └── WorkItemsControllerIntegrationTests.cs
```

---

## Domain Model — `Domain/WorkItem.cs`

```csharp
using System.Text.Json.Serialization;

namespace MyApi.Domain;

// ── Strongly-typed ID — zero boxing, cannot be confused with other Guid IDs ──
public readonly record struct WorkItemId(Guid Value)
{
    public static WorkItemId New() => new(Guid.NewGuid());
    public static WorkItemId From(Guid value) => new(value);

    public static bool TryParse(string input, out WorkItemId result)
    {
        if (Guid.TryParse(input, out var guid))
        {
            result = new WorkItemId(guid);
            return true;
        }
        result = default;
        return false;
    }

    public override string ToString() => Value.ToString();
}

// ── Aggregate root ────────────────────────────────────────────────────────────
public sealed class WorkItem
{
    public WorkItemId Id        { get; }
    public string     Title     { get; private set; }
    public DateTime   CreatedAt { get; }

    [JsonConstructor]
    private WorkItem(WorkItemId id, string title, DateTime createdAt)
    {
        Id        = id;
        Title     = title;
        CreatedAt = createdAt;
    }

    // Factory — only valid WorkItems can be constructed
    public static WorkItem Create(string title) =>
        new(WorkItemId.New(), title.Trim(), DateTime.UtcNow);

    // Reconstitute from persistence
    public static WorkItem Reconstitute(WorkItemId id, string title, DateTime createdAt) =>
        new(id, title, createdAt);
}
```

---

## Domain Error — `Domain/WorkItemError.cs`

```csharp
namespace MyApi.Domain;

// Abstract record base — sealed records expose primary constructor params as properties.
public abstract record WorkItemError
{
    public sealed record NotFound(WorkItemId Id) : WorkItemError;
    public sealed record ValidationError(string Message) : WorkItemError;
    public sealed record Conflict(string Message) : WorkItemError;
}
```

---

## Result Type — `Domain/Result.cs`

```csharp
namespace MyApi.Domain;

// Minimal Result<T> — keeps service signatures honest without a third-party library.
public sealed class Result<T>
{
    private readonly T?              _value;
    private readonly WorkItemError?  _error;

    private Result(T value)              { _value = value; IsSuccess = true; }
    private Result(WorkItemError error)  { _error = error; IsSuccess = false; }

    public bool            IsSuccess { get; }
    public bool            IsFailure => !IsSuccess;

    public T               Value => IsSuccess ? _value! : throw new InvalidOperationException("Result is a failure.");
    public WorkItemError   Error => IsFailure ? _error! : throw new InvalidOperationException("Result is a success.");

    public static Result<T> Success(T value)              => new(value);
    public static Result<T> Failure(WorkItemError error)  => new(error);

    // Pattern-match helper
    public TOut Match<TOut>(Func<T, TOut> onSuccess, Func<WorkItemError, TOut> onFailure) =>
        IsSuccess ? onSuccess(_value!) : onFailure(_error!);
}
```

> For richer Result semantics (railway-oriented, `Bind`, `Map`) use the
> `ErrorOr` or `OneOf` NuGet package. The above is zero-dependency and sufficient
> for straightforward APIs.

---

## Repository Interface — `Repositories/IWorkItemRepository.cs`

```csharp
using MyApi.Domain;

namespace MyApi.Repositories;

public interface IWorkItemRepository
{
    Task<IReadOnlyList<WorkItem>> GetAllAsync(CancellationToken ct = default);
    Task<WorkItem?>               GetByIdAsync(WorkItemId id, CancellationToken ct = default);
    Task<WorkItem>                SaveAsync(WorkItem item, CancellationToken ct = default);
    Task<bool>                    DeleteAsync(WorkItemId id, CancellationToken ct = default);
}
```

## Dapper Repository — `Repositories/DapperWorkItemRepository.cs`

```csharp
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using MyApi.Domain;
using MyApi.Options;

namespace MyApi.Repositories;

public sealed class DapperWorkItemRepository(IOptions<DatabaseOptions> dbOptions, ILogger<DapperWorkItemRepository> logger)
    : IWorkItemRepository
{
    private readonly string _connectionString = dbOptions.Value.ConnectionString;

    public async Task<IReadOnlyList<WorkItem>> GetAllAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT Id, Title, CreatedAt FROM WorkItems ORDER BY CreatedAt DESC";
        await using var conn = new SqlConnection(_connectionString);

        logger.LogDebug("Fetching all work items");
        var rows = await conn.QueryAsync<WorkItemRow>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.Select(Map).ToList();
    }

    public async Task<WorkItem?> GetByIdAsync(WorkItemId id, CancellationToken ct = default)
    {
        const string sql = "SELECT Id, Title, CreatedAt FROM WorkItems WHERE Id = @Id";
        await using var conn = new SqlConnection(_connectionString);

        var row = await conn.QuerySingleOrDefaultAsync<WorkItemRow>(
            new CommandDefinition(sql, new { Id = id.Value }, cancellationToken: ct));

        return row is null ? null : Map(row);
    }

    public async Task<WorkItem> SaveAsync(WorkItem item, CancellationToken ct = default)
    {
        const string sql = """
            INSERT INTO WorkItems (Id, Title, CreatedAt)
            VALUES (@Id, @Title, @CreatedAt)
            """;
        await using var conn = new SqlConnection(_connectionString);

        logger.LogDebug("Saving work item {WorkItemId}", item.Id);
        await conn.ExecuteAsync(new CommandDefinition(
            sql,
            new { Id = item.Id.Value, item.Title, item.CreatedAt },
            cancellationToken: ct));

        return item;
    }

    public async Task<bool> DeleteAsync(WorkItemId id, CancellationToken ct = default)
    {
        const string sql = "DELETE FROM WorkItems WHERE Id = @Id";
        await using var conn = new SqlConnection(_connectionString);

        var affected = await conn.ExecuteAsync(
            new CommandDefinition(sql, new { Id = id.Value }, cancellationToken: ct));

        return affected > 0;
    }

    private static WorkItem Map(WorkItemRow r) =>
        WorkItem.Reconstitute(WorkItemId.From(r.Id), r.Title, r.CreatedAt);

    // Private DTO — maps to DB columns, never exposed outside this class
    private sealed record WorkItemRow(Guid Id, string Title, DateTime CreatedAt);
}
```

---

## Service Interface — `Services/IWorkItemService.cs`

```csharp
using MyApi.Domain;

namespace MyApi.Services;

public interface IWorkItemService
{
    Task<IReadOnlyList<WorkItem>>  ListAllAsync(CancellationToken ct = default);
    Task<Result<WorkItem>>         GetByIdAsync(WorkItemId id, CancellationToken ct = default);
    Task<Result<WorkItem>>         CreateAsync(string title, CancellationToken ct = default);
    Task<Result<bool>>             DeleteAsync(WorkItemId id, CancellationToken ct = default);
}
```

## Service — `Services/WorkItemService.cs`

```csharp
using MyApi.Domain;
using MyApi.Repositories;

namespace MyApi.Services;

public sealed class WorkItemService(IWorkItemRepository repository, ILogger<WorkItemService> logger)
    : IWorkItemService
{
    public async Task<IReadOnlyList<WorkItem>> ListAllAsync(CancellationToken ct = default)
    {
        logger.LogDebug("Listing all work items");
        return await repository.GetAllAsync(ct);
    }

    public async Task<Result<WorkItem>> GetByIdAsync(WorkItemId id, CancellationToken ct = default)
    {
        var item = await repository.GetByIdAsync(id, ct);

        if (item is null)
        {
            logger.LogWarning("WorkItem {WorkItemId} not found", id);
            return Result<WorkItem>.Failure(new WorkItemError.NotFound(id));
        }

        return Result<WorkItem>.Success(item);
    }

    public async Task<Result<WorkItem>> CreateAsync(string title, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(title))
            return Result<WorkItem>.Failure(new WorkItemError.ValidationError("Title must not be blank."));

        var item = WorkItem.Create(title);
        await repository.SaveAsync(item, ct);

        logger.LogInformation("Created work item {WorkItemId} with title '{Title}'", item.Id, item.Title);
        return Result<WorkItem>.Success(item);
    }

    public async Task<Result<bool>> DeleteAsync(WorkItemId id, CancellationToken ct = default)
    {
        var deleted = await repository.DeleteAsync(id, ct);

        if (!deleted)
        {
            logger.LogWarning("Delete failed — work item {WorkItemId} not found", id);
            return Result<bool>.Failure(new WorkItemError.NotFound(id));
        }

        logger.LogInformation("Deleted work item {WorkItemId}", id);
        return Result<bool>.Success(true);
    }
}
```

> **Never throw** from services for domain errors. Let `ExceptionHandlerMiddleware`
> handle genuine unexpected exceptions — the service only knows about domain outcomes.

---

## Controller — `Controllers/WorkItemsController.cs`

```csharp
using Microsoft.AspNetCore.Mvc;
using MyApi.Domain;
using MyApi.Services;

namespace MyApi.Controllers;

[ApiController]
[Route("api/v1/workitems")]
[Produces("application/json")]
public sealed class WorkItemsController(IWorkItemService service, ILogger<WorkItemsController> logger)
    : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<WorkItem>>(StatusCodes.Status200OK)]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await service.ListAllAsync(ct));

    [HttpGet("{id:guid}")]
    [ProducesResponseType<WorkItem>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var result = await service.GetByIdAsync(WorkItemId.From(id), ct);
        return MapResult(result);
    }

    [HttpPost]
    [ProducesResponseType<WorkItem>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] CreateWorkItemRequest request, CancellationToken ct)
    {
        var result = await service.CreateAsync(request.Title, ct);
        return result.Match(
            onSuccess: item => CreatedAtAction(nameof(GetById), new { id = item.Id.Value }, item),
            onFailure: MapError);
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var result = await service.DeleteAsync(WorkItemId.From(id), ct);
        return result.Match(
            onSuccess: _ => (IActionResult)NoContent(),
            onFailure: MapError);
    }

    // ── Result → HTTP mapping ───────────────────────────────────────────────
    private IActionResult MapResult<T>(Result<T> result) =>
        result.Match(onSuccess: Ok, onFailure: MapError);

    private IActionResult MapError(WorkItemError error) => error switch
    {
        WorkItemError.NotFound e        => NotFound(ProblemFor(404, $"WorkItem {e.Id} not found.")),
        WorkItemError.ValidationError e => BadRequest(ProblemFor(400, e.Message)),
        WorkItemError.Conflict e        => Conflict(ProblemFor(409, e.Message)),
        _                               => StatusCode(500, ProblemFor(500, "Unexpected error."))
    };

    private ProblemDetails ProblemFor(int status, string detail) => new()
    {
        Status = status,
        Detail = detail,
        Instance = HttpContext.Request.Path
    };
}

// ── Request DTO ──────────────────────────────────────────────────────────────
public sealed record CreateWorkItemRequest(string Title);
```

---

## Validator — `Validators/CreateWorkItemRequestValidator.cs`

```csharp
using FluentValidation;
using MyApi.Controllers;

namespace MyApi.Validators;

public sealed class CreateWorkItemRequestValidator : AbstractValidator<CreateWorkItemRequest>
{
    public CreateWorkItemRequestValidator()
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

## Tests — `MyApi.Tests/Services/WorkItemServiceTests.cs`

```csharp
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using MyApi.Domain;
using MyApi.Repositories;
using MyApi.Services;
using NSubstitute;
using NSubstitute.ReturnsExtensions;
using WorkItemDomain = MyApi.Domain.WorkItem;

namespace MyApi.Tests.Services;

public sealed class WorkItemServiceTests
{
    private readonly IWorkItemRepository _repository = Substitute.For<IWorkItemRepository>();
    private readonly WorkItemService     _sut;

    public WorkItemServiceTests()
    {
        _sut = new WorkItemService(_repository, NullLogger<WorkItemService>.Instance);
    }

    // ── ListAllAsync ────────────────────────────────────────────────────────
    [Fact]
    public async System.Threading.Tasks.Task ListAllAsync_WhenCalled_ReturnsRepositoryResult()
    {
        var items = new[] { WorkItemDomain.Create("Buy milk") };
        _repository.GetAllAsync().Returns(items);

        var result = await _sut.ListAllAsync();

        result.Should().BeEquivalentTo(items);
    }

    // ── GetByIdAsync ────────────────────────────────────────────────────────
    [Fact]
    public async System.Threading.Tasks.Task GetByIdAsync_WhenWorkItemExists_ReturnsSuccess()
    {
        var item = WorkItemDomain.Create("Buy milk");
        _repository.GetByIdAsync(item.Id).Returns(item);

        var result = await _sut.GetByIdAsync(item.Id);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be(item);
    }

    // ── CreateAsync ─────────────────────────────────────────────────────────
    [Fact]
    public async System.Threading.Tasks.Task CreateAsync_WithValidTitle_ReturnsCreatedWorkItem()
    {
        _repository.SaveAsync(Arg.Any<WorkItemDomain>())
                   .Returns(callInfo => callInfo.Arg<WorkItemDomain>());

        var result = await _sut.CreateAsync("Walk the dog");

        result.IsSuccess.Should().BeTrue();
        result.Value.Title.Should().Be("Walk the dog");
        await _repository.Received(1).SaveAsync(Arg.Is<WorkItemDomain>(t => t.Title == "Walk the dog"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async System.Threading.Tasks.Task CreateAsync_WithBlankTitle_ReturnsValidationError(string? title)
    {
        var result = await _sut.CreateAsync(title!);

        result.IsFailure.Should().BeTrue();
        result.Error.Should().BeOfType<WorkItemError.ValidationError>();
        await _repository.DidNotReceive().SaveAsync(Arg.Any<WorkItemDomain>());
    }

    // ── DeleteAsync ─────────────────────────────────────────────────────────
    [Fact]
    public async System.Threading.Tasks.Task DeleteAsync_WhenWorkItemExists_ReturnsSuccess()
    {
        var id = WorkItemId.New();
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

## Integration Test — `MyApi.Tests/Controllers/WorkItemsControllerIntegrationTests.cs`

```csharp
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using MyApi.Controllers;
using MyApi.Domain;
using MyApi.Repositories;
using WorkItemDomain = MyApi.Domain.WorkItem;

namespace MyApi.Tests.Controllers;

// ── Custom factory — replaces Dapper repository with in-memory stub ──────────
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Provide a non-empty connection string so ValidateOnStart() passes
        builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:ConnectionString"] = "Server=test-stub;Database=test"
            }));

        builder.ConfigureServices(services =>
        {
            var descriptor = services.SingleOrDefault(
                d => d.ServiceType == typeof(IWorkItemRepository));
            if (descriptor is not null)
                services.Remove(descriptor);

            services.AddScoped<IWorkItemRepository, InMemoryWorkItemRepository>();
        });
    }
}

// ── In-memory repository stub ────────────────────────────────────────────────
public sealed class InMemoryWorkItemRepository : IWorkItemRepository
{
    private readonly List<WorkItemDomain> _store = [];

    public System.Threading.Tasks.Task<IReadOnlyList<WorkItemDomain>> GetAllAsync(CancellationToken ct = default)
        => System.Threading.Tasks.Task.FromResult<IReadOnlyList<WorkItemDomain>>(_store.ToList());

    public System.Threading.Tasks.Task<WorkItemDomain?> GetByIdAsync(WorkItemId id, CancellationToken ct = default)
        => System.Threading.Tasks.Task.FromResult<WorkItemDomain?>(_store.FirstOrDefault(t => t.Id == id));

    public System.Threading.Tasks.Task<WorkItemDomain> SaveAsync(WorkItemDomain item, CancellationToken ct = default)
    {
        _store.Add(item);
        return System.Threading.Tasks.Task.FromResult(item);
    }

    public System.Threading.Tasks.Task<bool> DeleteAsync(WorkItemId id, CancellationToken ct = default)
    {
        var item = _store.FirstOrDefault(t => t.Id == id);
        if (item is null) return System.Threading.Tasks.Task.FromResult(false);
        _store.Remove(item);
        return System.Threading.Tasks.Task.FromResult(true);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
public sealed class WorkItemsControllerIntegrationTests(ApiFactory factory)
    : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async System.Threading.Tasks.Task Post_WithValidTitle_Returns201AndCreatedWorkItem()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/workitems", new CreateWorkItemRequest("Buy milk"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var item = await response.Content.ReadFromJsonAsync<WorkItemDomain>();
        item!.Title.Should().Be("Buy milk");
    }

    [Fact]
    public async System.Threading.Tasks.Task Post_WithEmptyTitle_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/workitems", new CreateWorkItemRequest(""));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async System.Threading.Tasks.Task Get_UnknownId_Returns404()
    {
        var response = await _client.GetAsync($"/api/v1/workitems/{Guid.NewGuid()}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
```

> `ApiFactory` replaces `DapperWorkItemRepository` with an in-memory stub so
> integration tests run without a real SQL Server instance. The fake connection
> string satisfies `ValidateOnStart()` on `DatabaseOptions`.
> Make `Program` accessible to the test project by adding
> `<InternalsVisibleTo Include="MyApi.Tests" />` to the `.csproj` or by
> adding a `public partial class Program {}` at the bottom of `Program.cs`.
