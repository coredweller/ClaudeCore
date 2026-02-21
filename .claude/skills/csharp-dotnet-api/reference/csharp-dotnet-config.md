# C# .NET 8 Web API — Config Reference

## Directory Layout

```
MyApi/
├── MyApi.csproj
├── Program.cs                    # Entry point + DI registration
├── appsettings.json
├── appsettings.Development.json
├── Directory.Build.props         # Shared compiler settings for all projects
├── Controllers/
├── Domain/
├── Services/
├── Repositories/
├── Middleware/
├── Validators/
└── Options/
MyApi.Tests/
├── MyApi.Tests.csproj
└── Services/
    └── TaskServiceTests.cs
Dockerfile
docker-compose.yml
```

---

## MyApi.csproj

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <WarningsAsErrors />
    <Deterministic>true</Deterministic>
    <RootNamespace>MyApi</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <!-- HTTP / hosting -->
    <PackageReference Include="Serilog.AspNetCore"              Version="8.0.3" />
    <PackageReference Include="Serilog.Sinks.Console"           Version="6.0.0" />
    <!-- Dapper + DB -->
    <PackageReference Include="Dapper"                          Version="2.1.35" />
    <PackageReference Include="Microsoft.Data.SqlClient"        Version="5.2.2" />
    <!-- Validation -->
    <PackageReference Include="FluentValidation.AspNetCore"     Version="11.3.0" />
    <!-- OpenAPI -->
    <PackageReference Include="Swashbuckle.AspNetCore"          Version="6.9.0" />
  </ItemGroup>

</Project>
```

## MyApi.Tests.csproj

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk"        Version="17.11.1" />
    <PackageReference Include="xunit"                         Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio"     Version="2.8.2" />
    <PackageReference Include="NSubstitute"                   Version="5.3.0" />
    <PackageReference Include="FluentAssertions"              Version="6.12.1" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="8.0.10" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\MyApi\MyApi.csproj" />
  </ItemGroup>

</Project>
```

## Directory.Build.props

```xml
<Project>
  <PropertyGroup>
    <!-- Enforce nullable reference types and fatal warnings across all projects -->
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <LangVersion>latest</LangVersion>
    <AnalysisMode>All</AnalysisMode>
  </PropertyGroup>
</Project>
```

> **`TreatWarningsAsErrors`** at the `Directory.Build.props` level ensures both the
> API project and test project fail on any warning — nullable dereferences, unused
> variables, etc. Run `dotnet build --warnaserror` explicitly in CI to be certain.

---

## Program.cs

```csharp
using FluentValidation;
using MyApi.Middleware;
using MyApi.Options;
using MyApi.Repositories;
using MyApi.Services;
using MyApi.Validators;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // ── Logging ────────────────────────────────────────────────
    builder.Host.UseSerilog((ctx, services, config) =>
        config.ReadFrom.Configuration(ctx.Configuration)
              .ReadFrom.Services(services)
              .Enrich.FromLogContext());

    // ── Controllers + API explorer ─────────────────────────────
    builder.Services.AddControllers();
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();

    // ── ProblemDetails (RFC 7807) ──────────────────────────────
    builder.Services.AddProblemDetails();

    // ── Options ────────────────────────────────────────────────
    builder.Services
        .AddOptions<DatabaseOptions>()
        .BindConfiguration(DatabaseOptions.Section)
        .ValidateDataAnnotations()
        .ValidateOnStart();

    // ── FluentValidation ───────────────────────────────────────
    builder.Services.AddValidatorsFromAssemblyContaining<Program>();

    // ── Application services ───────────────────────────────────
    builder.Services.AddScoped<ITaskRepository, DapperTaskRepository>();
    builder.Services.AddScoped<ITaskService, TaskService>();

    // ── Health checks ──────────────────────────────────────────
    builder.Services.AddHealthChecks();

    var app = builder.Build();

    // ── Middleware pipeline ────────────────────────────────────
    app.UseExceptionHandler();       // Maps unhandled exceptions to ProblemDetails
    app.UseStatusCodePages();        // Maps 404/405 to ProblemDetails

    if (app.Environment.IsDevelopment())
    {
        app.UseSwagger();
        app.UseSwaggerUI();
    }

    app.UseSerilogRequestLogging();
    app.UseHttpsRedirection();
    app.UseAuthorization();
    app.MapControllers();
    app.MapHealthChecks("/api/v1/health");

    app.Run();
}
catch (Exception ex) when (ex is not HostAbortedException)
{
    Log.Fatal(ex, "Application failed to start");
    return 1;
}
finally
{
    Log.CloseAndFlush();
}

return 0;
```

> The `try/catch` around startup catches fatal exceptions (e.g. missing config,
> failed DB connection) and logs them before the process exits with code 1.
> `HostAbortedException` is excluded — it is thrown intentionally by `dotnet run`
> on CTRL+C and should not be treated as an error.

---

## appsettings.json

```json
{
  "Serilog": {
    "MinimumLevel": {
      "Default": "Information",
      "Override": {
        "Microsoft": "Warning",
        "Microsoft.Hosting.Lifetime": "Information",
        "System": "Warning"
      }
    },
    "WriteTo": [
      { "Name": "Console" }
    ],
    "Enrich": ["FromLogContext", "WithMachineName", "WithThreadId"]
  },
  "Database": {
    "ConnectionString": ""
  },
  "AllowedHosts": "*"
}
```

## appsettings.Development.json

```json
{
  "Serilog": {
    "MinimumLevel": {
      "Default": "Debug",
      "Override": {
        "Microsoft.AspNetCore": "Debug"
      }
    }
  },
  "Database": {
    "ConnectionString": "Server=localhost;Database=myapi_dev;User Id=sa;Password=Your_password123;TrustServerCertificate=True;"
  }
}
```

---

## Options/DatabaseOptions.cs

```csharp
using System.ComponentModel.DataAnnotations;

namespace MyApi.Options;

public sealed class DatabaseOptions
{
    public const string Section = "Database";

    [Required, MinLength(1)]
    public string ConnectionString { get; init; } = string.Empty;
}
```

> `ValidateDataAnnotations().ValidateOnStart()` in `Program.cs` means a missing or
> empty connection string crashes the app at startup with a clear error — not on the
> first request.

---

## Dockerfile

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Restore dependencies (cached layer)
COPY ["MyApi/MyApi.csproj", "MyApi/"]
RUN dotnet restore "MyApi/MyApi.csproj"

# Build and publish
COPY . .
WORKDIR /src/MyApi
RUN dotnet publish -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
EXPOSE 8080

ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "MyApi.dll"]
```

> Two-stage build keeps the final image small (aspnet runtime only, ~220 MB vs ~800 MB sdk).
> `ASPNETCORE_URLS=http://+:8080` avoids the HTTPS certificate pain in containers.

## docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      ASPNETCORE_ENVIRONMENT: Development
      Database__ConnectionString: "Server=db;Database=myapi_dev;User Id=sa;Password=Your_password123;TrustServerCertificate=True;"
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/api/v1/health"]
      interval: 10s
      retries: 3

  db:
    image: mcr.microsoft.com/mssql/server:2022-latest
    ports:
      - "1433:1433"
    environment:
      SA_PASSWORD: "Your_password123"
      ACCEPT_EULA: "Y"
    healthcheck:
      test: /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Your_password123" -C -Q "SELECT 1"
      interval: 10s
      retries: 5
```

> Environment variable override uses `__` as the section separator:
> `Database__ConnectionString` maps to `Database:ConnectionString` in config.
> Build: `docker-compose up --build`
