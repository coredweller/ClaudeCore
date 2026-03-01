---
description: Scaffold a new Kotlin 2.x + Ktor 3.x REST API with Koin DI, Exposed ORM, Flyway, and a sample endpoint
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs
disable-model-invocation: true
---

# Scaffold Kotlin + Ktor REST API

**Project name:** $ARGUMENTS (default to "my-ktor-api" if not provided)

Delegate to the `kotlin-api` skill for all patterns, templates, and reference files.

## Pre-requisites

1. Read the `kotlin-api` skill (`SKILL.md` and all reference files) before writing any code.
2. Use Context7 MCP (`resolve-library-id` then `query-docs`) to verify current Ktor, Exposed, and Koin APIs — they evolve quickly. Key libraries: `ktorio/ktor`, `JetBrains/Exposed`, `InsertKoinIO/koin`.
3. Verify Kotlin 2.x syntax (value classes, sealed classes, `@JvmInline`) against Context7 — do NOT use deprecated `inline class` syntax or Kotlin 1.x patterns.

## Steps

1. **Create Gradle project** — Create `settings.gradle.kts` and `build.gradle.kts` per skill config reference (`reference/kotlin-api-config.md`). Set Kotlin version to `2.1.20` and Ktor version to `3.1.1`. Include all required dependencies: Ktor server/Netty, kotlinx.serialization, Exposed, HikariCP, Flyway, Koin, Arrow, Logback, Kotest, MockK, Testcontainers. Add `detekt` and `ktlint` plugins.

2. **Configure application** — Create `src/main/resources/application.conf` (HOCON) with `ktor.deployment.port`, `database.url/user/password/pool`, and `jwt.secret/issuer/audience/expiry-seconds`. All sensitive values use `${?ENV_VAR}` substitution. Add `src/main/resources/logback.xml` with structured JSON output (Logback + logstash encoder). Add `detekt.yml` with `maxLineLength: 140`.

3. **Create `Application.kt` entry point** — `fun main(args: Array<String>) = EngineMain.main(args)` and `fun Application.module()` that calls: `configureDI()`, `configureSerialization()`, `configureMonitoring()`, `configureStatusPages()`, `configureDatabase()`, `configureRouting()`. Read `reference/kotlin-api-templates.md` for the exact template.

4. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to Kotlin or general cross-cutting concerns like `code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`, and `code-reviewer`.

5. **Wire Koin DI** — Create `config/DIModules.kt` with a top-level `val appModule = module { ... }` and `fun Application.configureDI()` installing the Koin plugin with `slf4jLogger()`. Register `TaskRepository` as `single<TaskRepository> { TaskRepositoryImpl() }` and `TaskService` as `single { TaskService(get()) }`.

6. **Configure serialization** — Create `config/Serialization.kt` installing `ContentNegotiation` with `json(Json { prettyPrint = false; isLenient = false; ignoreUnknownKeys = false; encodeDefaults = true })`.

7. **Configure error handling** — Create `config/StatusPages.kt` installing `StatusPages`. Map each `DomainError` subtype to the correct HTTP status + RFC 9457 `ProblemDetail` JSON response. Map `DomainError.NotFound` → 404, `DomainError.AlreadyExists` → 409, `DomainError.ValidationFailed` → 400. Catch `Throwable` → log with SLF4J + respond 500. Read `reference/kotlin-api-templates.md` for the exact template.

8. **Configure database** — Create `config/Database.kt` reading HOCON config, building a `HikariDataSource`, running Flyway migrations from `classpath:db/migration`, then calling `Database.connect(dataSource)`. Log migration count on success.

9. **Create `common/DomainError.kt`** — Sealed class hierarchy: `NotFound(id: UUID)`, `AlreadyExists(field: String, value: String)`, `ValidationFailed(errors: List<String>)`. All extend `Exception(message)`.

10. **Create domain model** — Define a sample `Task` domain in `feature/task/`:
    - `@JvmInline value class TaskId(val value: UUID)` with `companion object { fun new() ... ; fun from(value: String) ... }`
    - `data class Task(id: TaskId, title: String, description: String?, createdAt: Instant, updatedAt: Instant)` — all `val`, no `var`
    - `@Serializable data class CreateTaskRequest(val title: String, val description: String?)` with a `companion object { val validate = Validation { ... } }` using Konform
    - `@Serializable data class TaskResponse(...)` and `fun Task.toResponse(): TaskResponse` extension

11. **Create repository layer** — `TaskRepository` interface with `suspend fun findById(id: TaskId): Task?`, `suspend fun findAll(): List<Task>`, `suspend fun save(task: Task): Task`, `suspend fun existsByTitle(title: String): Boolean`. Implement `TaskRepositoryImpl` backed by Exposed DSL with `object TasksTable : Table("tasks")` and `newSuspendedTransaction(Dispatchers.IO)` for every query. Read `reference/kotlin-api-templates.md` for the mapper pattern.

12. **Create service layer** — `TaskService(private val repo: TaskRepository)` with all methods `suspend` returning `Either<DomainError, T>`. Validate with Konform first (return `Left(ValidationFailed(...))` on errors), check for conflicts, delegate to repo, log on success with SLF4J. No `HttpStatusCode` references anywhere in the service. Read `reference/kotlin-api-templates.md` for the pattern.

13. **Create routes** — `fun Route.taskRoutes()` extension in `feature/task/TaskRoutes.kt`. Mount at `/api/v1/tasks` with:
    - `GET /` → `service.findAll()`, respond 200 with list
    - `GET /{id}` → `service.findById(id)`, fold: throw error (caught by StatusPages) or respond 200
    - `POST /` → `call.receive<CreateTaskRequest>()`, `service.create(request)`, fold: throw or respond 201
    - `DELETE /{id}` → `service.delete(id)`, fold: throw or respond 204
    Use `by inject<TaskService>()` for DI. Read `reference/kotlin-api-templates.md` for the exact route pattern.

14. **Register routes** — Update `config/Routing.kt` to call `taskRoutes()` and `healthRoutes()` inside `routing { }`.

15. **Create health endpoint** — `fun Route.healthRoutes()` at `GET /api/v1/health` responding `200 OK` with `{"status":"ok","timestamp":"<ISO-8601>"}`.

16. **Add Flyway migration** — Create `src/main/resources/db/migration/V1__create_tasks_table.sql`:
    ```sql
    CREATE TABLE tasks (
        id          UUID         NOT NULL PRIMARY KEY,
        title       VARCHAR(255) NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ  NOT NULL,
        updated_at  TIMESTAMPTZ  NOT NULL
    );
    CREATE INDEX idx_tasks_title ON tasks (title);
    ```

17. **Add `.gitignore`** — Include `.gradle/`, `build/`, `*.class`, `*.jar`, `.idea/`, `*.iml`, `.DS_Store`, `.env`, `local.properties`.

18. **Add Docker support** — `Dockerfile` using `eclipse-temurin:21-jre-alpine`, copying `build/libs/*-all.jar` to `app.jar`, `EXPOSE 8080`, `ENTRYPOINT ["java", "-jar", "app.jar"]`. Add `docker-compose.yml` with app (port 8080) and `postgres:17-alpine` service with health check. Read `reference/kotlin-api-config.md` for exact templates.

19. **Write tests** — Create `feature/task/TaskServiceTest.kt` using Kotest `DescribeSpec`. Cover: `findById` found → `Right(Task)`, `findById` missing → `Left(NotFound)`, `create` valid → `Right(Task)` + repo save called, `create` duplicate title → `Left(AlreadyExists)` + save NOT called, `create` invalid request → `Left(ValidationFailed)` + repo never touched. Use `mockk<TaskRepository>()` with `coEvery`/`coVerify`. Read `reference/kotlin-api-testing.md` for the exact Kotest + MockK pattern.

    Create `feature/task/TaskRoutesTest.kt` using `testApplication` with a test Koin module injecting the mock repo. Cover `GET /api/v1/tasks`, `GET /api/v1/tasks/{id}` (found + not found), `POST /api/v1/tasks` (valid + invalid). Read `reference/kotlin-api-testing.md` for the `testApplication` pattern.

20. **Verify** — Run `./gradlew detekt ktlintCheck build`. Zero detekt warnings, zero ktlint violations, all tests green. If any step fails, fix it before proceeding.

21. **Print summary** — List all created files, print `./gradlew run` to start (default port 8080), and list next steps: add JWT auth (`configureAuth()`), add Testcontainers DB integration tests, add OpenAPI spec with `ktor-swagger-ui`.
