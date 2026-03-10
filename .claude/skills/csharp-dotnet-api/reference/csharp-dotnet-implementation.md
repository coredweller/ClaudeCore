# C# .NET 8 Web API — Implementation Templates

Concrete infrastructure and web layer: Dapper repository, service business logic, ASP.NET Core controller, FluentValidation validator, and exception middleware.

---

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

> Never expose raw Dapper row types outside the repository. Reconstitute domain objects
> at the repository boundary — callers never see DB internals.
> `CommandDefinition` with `cancellationToken` ensures all queries respect request cancellation.

---

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
> Log at `LogWarning` for expected failures (not found), `LogInformation` for mutations, `LogDebug` for reads.

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

> Route handlers only map `Result<T>` to HTTP. Business rules live in the service.
> `[ApiController]` automatically runs FluentValidation validators registered with DI
> and returns 400 with a `ValidationProblemDetails` body before the action executes —
> no manual `ModelState.IsValid` checks needed.

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

> Register with `services.AddFluentValidationAutoValidation()` in `Program.cs`.
> FluentValidation + `[ApiController]` auto-400 runs validators before the action body —
> the service never sees an invalid request.

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

> Prefer `app.UseExceptionHandler()` + `IProblemDetailsService` in `Program.cs` over this
> custom middleware. Use `ExceptionMiddleware` only when the built-in handler can't be
> configured to produce the exact response shape you need.
