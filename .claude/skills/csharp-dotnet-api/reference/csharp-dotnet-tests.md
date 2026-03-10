# C# .NET 8 Web API — Test Templates

Unit tests (service logic, no I/O) and integration tests (full HTTP pipeline via `WebApplicationFactory`).

---

## Unit Tests — `MyApi.Tests/Services/WorkItemServiceTests.cs`

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
    public async Task ListAllAsync_WhenCalled_ReturnsRepositoryResult()
    {
        var items = new[] { WorkItemDomain.Create("Buy milk") };
        _repository.GetAllAsync().Returns(items);

        var result = await _sut.ListAllAsync();

        result.Should().BeEquivalentTo(items);
    }

    // ── GetByIdAsync ────────────────────────────────────────────────────────
    [Fact]
    public async Task GetByIdAsync_WhenWorkItemExists_ReturnsSuccess()
    {
        var item = WorkItemDomain.Create("Buy milk");
        _repository.GetByIdAsync(item.Id).Returns(item);

        var result = await _sut.GetByIdAsync(item.Id);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be(item);
    }

    [Fact]
    public async Task GetByIdAsync_WhenWorkItemDoesNotExist_ReturnsNotFound()
    {
        var id = WorkItemId.New();
        _repository.GetByIdAsync(id).ReturnsNull();

        var result = await _sut.GetByIdAsync(id);

        result.IsFailure.Should().BeTrue();
        result.Error.Should().BeOfType<WorkItemError.NotFound>();
    }

    // ── CreateAsync ─────────────────────────────────────────────────────────
    [Fact]
    public async Task CreateAsync_WithValidTitle_ReturnsCreatedWorkItem()
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
    public async Task CreateAsync_WithBlankTitle_ReturnsValidationError(string? title)
    {
        var result = await _sut.CreateAsync(title!);

        result.IsFailure.Should().BeTrue();
        result.Error.Should().BeOfType<WorkItemError.ValidationError>();
        await _repository.DidNotReceive().SaveAsync(Arg.Any<WorkItemDomain>());
    }

    // ── DeleteAsync ─────────────────────────────────────────────────────────
    [Fact]
    public async Task DeleteAsync_WhenWorkItemExists_ReturnsSuccess()
    {
        var id = WorkItemId.New();
        _repository.DeleteAsync(id).Returns(true);

        var result = await _sut.DeleteAsync(id);

        result.IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task DeleteAsync_WhenWorkItemDoesNotExist_ReturnsNotFound()
    {
        var id = WorkItemId.New();
        _repository.DeleteAsync(id).Returns(false);

        var result = await _sut.DeleteAsync(id);

        result.IsFailure.Should().BeTrue();
        result.Error.Should().BeOfType<WorkItemError.NotFound>();
    }
}
```

> `NullLogger<T>.Instance` avoids mocking the logger — logging is a side effect,
> not a domain concern, so tests shouldn't assert on it unless you're testing an
> auditing/observability feature specifically.
> `NSubstitute.ReturnsExtensions.ReturnsNull()` is the idiomatic way to stub nullable returns.

---

## Integration Tests — `MyApi.Tests/Controllers/WorkItemsControllerIntegrationTests.cs`

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

    public Task<IReadOnlyList<WorkItemDomain>> GetAllAsync(CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<WorkItemDomain>>(_store.ToList());

    public Task<WorkItemDomain?> GetByIdAsync(WorkItemId id, CancellationToken ct = default)
        => Task.FromResult<WorkItemDomain?>(_store.FirstOrDefault(t => t.Id == id));

    public Task<WorkItemDomain> SaveAsync(WorkItemDomain item, CancellationToken ct = default)
    {
        _store.Add(item);
        return Task.FromResult(item);
    }

    public Task<bool> DeleteAsync(WorkItemId id, CancellationToken ct = default)
    {
        var item = _store.FirstOrDefault(t => t.Id == id);
        if (item is null) return Task.FromResult(false);
        _store.Remove(item);
        return Task.FromResult(true);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
public sealed class WorkItemsControllerIntegrationTests(ApiFactory factory)
    : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Post_WithValidTitle_Returns201AndCreatedWorkItem()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/workitems", new CreateWorkItemRequest("Buy milk"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var item = await response.Content.ReadFromJsonAsync<WorkItemDomain>();
        item!.Title.Should().Be("Buy milk");
    }

    [Fact]
    public async Task Post_WithEmptyTitle_Returns400()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/workitems", new CreateWorkItemRequest(""));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Get_UnknownId_Returns404()
    {
        var response = await _client.GetAsync($"/api/v1/workitems/{Guid.NewGuid()}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Delete_ExistingItem_Returns204()
    {
        var postResponse = await _client.PostAsJsonAsync("/api/v1/workitems", new CreateWorkItemRequest("Walk the dog"));
        var created = await postResponse.Content.ReadFromJsonAsync<WorkItemDomain>();

        var deleteResponse = await _client.DeleteAsync($"/api/v1/workitems/{created!.Id.Value}");

        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task Delete_UnknownId_Returns404()
    {
        var response = await _client.DeleteAsync($"/api/v1/workitems/{Guid.NewGuid()}");

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
> `IClassFixture<ApiFactory>` shares one `HttpClient` across all tests in the class —
> the in-memory store persists between tests within a fixture instance.
