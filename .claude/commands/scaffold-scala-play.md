---
description: Scaffold a new Scala 3 Play Framework application with Cats Effect, compile-time DI, and a sample endpoint
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs
disable-model-invocation: true
---

# Scaffold Scala 3 Play Framework Application

**Project name:** $ARGUMENTS (default to "my-play-app" if not provided)

Delegate to the `scala-play` skill for all patterns, templates, and reference files.

## Pre-requisites

1. Read the `scala-play` skill (`SKILL.md` and all reference files) before writing any code.
2. Use Context7 MCP (`resolve-library-id` then `query-docs`) to verify Play Framework and Cats Effect APIs — both evolve quickly. Key libraries: `playframework/playframework`, `typelevel/cats-effect`.
3. Verify Scala 3 syntax (given/using, opaque types, enum) against Context7 — do NOT use Scala 2 `implicit def` or sealed trait patterns where Scala 3 enums apply.

## Steps

1. **Create sbt project** — Create `build.sbt`, `project/plugins.sbt`, `project/build.properties` per skill config reference. Use `sbt new playframework/play-scala-seed.g8` or manual scaffold. Set `scalaVersion := "3.3.4"`.

2. **Configure dependencies** — Add to `build.sbt`: Play Framework 3.0.x, Cats Effect 3.x, Cats Core, fs2-core, iron (refined types), scalatest + cats-effect-testing-scalatest. Read `reference/scala-play-config.md` for exact versions and sbt settings.

3. **Set up compile-time DI** — Create `AppComponents` extending `BuiltInComponentsFromContext` with `HttpFiltersComponents`. Wire all dependencies manually. Create `AppLoader` extending `ApplicationLoader`. Do NOT use Guice or `@Inject` — compile-time DI is required per the skill.

4. **Configure Play** — Add `application.conf` with secret key (`${APP_SECRET}`), allowed hosts filter, CORS filter config, and CSRF settings. Add `logback.xml` for structured logging. Read `reference/scala-play-config.md` for templates.

5. **Configure Claude** - Add all the items from `.claude` in this repository to the new repository's `.claude` folder that is related to Scala or other general cross cutting items like `code-standards.md` or `code-reviewer`.

6. **Create domain model** — Define a sample `Task` domain:
   - Opaque type `TaskId` wrapping `UUID`
   - `case class Task(id: TaskId, title: String, createdAt: Instant)`
   - Scala 3 `enum TaskError`: `NotFound(id: TaskId)`, `ValidationError(msg: String)`
   - Play JSON `given Format[Task]` (not implicit — use Scala 3 `given`)

7. **Create repository layer** — `TaskRepository` trait with `IO`-returning methods. Implement `InMemoryTaskRepository` backed by `Ref[IO, Map[TaskId, Task]]`. Wire in `AppComponents`. Read `reference/scala-play-templates.md` for template.

8. **Create service layer** — `TaskService` wrapping repository. All methods return `IO[Either[TaskError, A]]`. No `Future` anywhere — use `IO` throughout. Use `cats-retry` for any external calls.

9. **Create controller** — `TaskController(service: TaskService, cc: ControllerComponents)`. All actions use `Action.async`. Convert `IO` to `Future` at the controller boundary using `unsafeToFuture` with an explicit `IORuntime`. Handle `TaskError` exhaustively via pattern match, map to appropriate HTTP status codes.

10. **Register routes** — Add to `conf/routes`:
   ```
   GET    /api/v1/tasks        controllers.TaskController.list
   POST   /api/v1/tasks        controllers.TaskController.create
   GET    /api/v1/tasks/:id    controllers.TaskController.findById(id: String)
   GET    /api/v1/health       controllers.HealthController.check
   ```

11. **Create health controller** — `HealthController` returning `200 OK` with JSON `{"status":"ok","timestamp":"..."}`.

12. **Add .gitignore file** - Add a `.gitignore` file to the root with the general stuff you want git to ignore from a Scala project like `*.class` or `target/*`

13. **Add Docker support** — `Dockerfile` using `sbt stage` output (`target/universal/stage`). Add `docker-compose.yml` with the app service exposing port 9000.

14. **Write tests** — Unit test for `TaskService` using `cats-effect-testing-scalatest` with `AsyncWordSpec` + `CatsEffectSuite`. Cover: list empty, create success, findById found, findById NotFound. Read `reference/scala-play-templates.md` for the test template.

15. **Verify** — Run `sbt compile` with `-Xfatal-warnings` (zero warnings required) then `sbt test` (all green).

16. **Print summary** — List all created files, `sbt run` to start, default port 9000, next steps (add Slick/Doobie for DB, add auth, etc.).
