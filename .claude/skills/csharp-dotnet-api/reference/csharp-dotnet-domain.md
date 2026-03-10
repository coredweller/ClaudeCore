# C# .NET 8 Web API — Domain Templates

Pure C# domain layer: aggregate roots, value objects, error types, Result type, and repository/service contracts.
No framework dependencies — these files have zero ASP.NET Core, Dapper, or xUnit imports.

## Directory Layout

```
MyApi/
├── Domain/
│   ├── WorkItem.cs                # Aggregate root + strongly-typed ID
│   ├── WorkItemError.cs           # Abstract record error hierarchy
│   └── Result.cs                  # Generic Result<T> type
├── Repositories/
│   ├── IWorkItemRepository.cs
│   └── DapperWorkItemRepository.cs  # (see implementation reference)
├── Services/
│   ├── IWorkItemService.cs
│   └── WorkItemService.cs           # (see implementation reference)
├── Controllers/
│   └── WorkItemsController.cs       # (see implementation reference)
├── Validators/
│   └── CreateWorkItemRequestValidator.cs  # (see implementation reference)
└── Middleware/
    └── ExceptionMiddleware.cs       # (see implementation reference)
MyApi.Tests/
├── Services/
│   └── WorkItemServiceTests.cs      # (see test reference)
└── Controllers/
    └── WorkItemsControllerIntegrationTests.cs  # (see test reference)
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

> `WorkItemId` is a `readonly record struct` wrapping `Guid` — zero allocation, no boxing,
> and the type system prevents accidentally passing a raw `Guid` where `WorkItemId` is expected.
> Use `WorkItemId.New()` for new entities and `WorkItemId.From(guid)` at persistence boundaries only.

---

## Domain Errors — `Domain/WorkItemError.cs`

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

> The `abstract record` hierarchy is exhaustive and pattern-matchable via `switch`.
> Controllers `switch` on `WorkItemError` to map to HTTP status codes — no magic strings,
> no `if (e.Message.Contains("not found"))`.

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

> The interface depends only on domain types — no Dapper imports, no connection strings.
> This keeps the domain layer framework-agnostic and allows the Dapper implementation
> to be swapped for an in-memory stub in integration tests without touching any service code.

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

> `ListAllAsync()` returns `IReadOnlyList<WorkItem>` directly — it never fails in a domain sense
> (an empty list is a valid result). Methods that can fail return `Task<Result<T>>`.
> Controllers depend on `IWorkItemService`, not the concrete `WorkItemService` —
> this enables stub injection via `WebApplicationFactory` in integration tests.
