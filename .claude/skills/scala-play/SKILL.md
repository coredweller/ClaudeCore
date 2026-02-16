---
name: scala-play
description: Skill for Scala 3 Play Framework applications with Cats Effect IO, compile-time DI, and functional domain modeling. Activate when creating Play controllers, services, repositories, domain models, or tests.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Scala 3 + Play Framework Skill

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| DI | Compile-time (`AppLoader`) | Type-safe, no runtime reflection, no Guice |
| Effects | `cats.effect.IO` | Structured concurrency, cancellation, resource safety |
| JSON | Play JSON `given Format[T]` | First-class Play integration, no circe glue needed |
| Domain types | Opaque types + iron | Zero-cost safety, no boxing overhead |
| Syntax | Scala 3 `given`/`using`, enum | No `implicit def`, no sealed trait where enum fits |
| Testing | cats-effect-testing-scalatest | Native IO test support, no `.unsafeRunSync()` in tests |

## Process

1. Read `reference/scala-play-config.md` — exact `build.sbt`, `plugins.sbt`, `application.conf`
2. Read `reference/scala-play-templates.md` — AppLoader, Controller, Service, Repository, Domain, Test templates
3. Scaffold compile-time DI wiring (`AppLoader` + `AppComponents`) **first** — everything else depends on it
4. Use `IO` for ALL async/effectful work; convert to `Future` only at the `Action.async` boundary
5. Run `sbt compile -Xfatal-warnings && sbt test` before finishing

## Common Commands

```bash
sbt run                    # Start dev server (port 9000, hot reload via sbt-revolver)
sbt ~run                   # Watch mode
sbt test                   # Run all tests
sbt compile                # Compile only
sbt scalafmtAll            # Format all sources
sbt scalafmtCheckAll       # Check formatting (CI gate)
sbt dist                   # Build production .zip package
sbt stage                  # Stage for Docker (output: target/universal/stage)
sbt dependencyTree         # Visualize transitive dependencies
```

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| Domain IDs | Opaque type wrapping `UUID` |
| Errors | Scala 3 `enum DomainError` |
| Repository | Trait + `IO`-returning methods |
| In-memory impl | `Ref[IO, Map[K, V]]` |
| Service | Returns `IO[Either[DomainError, A]]` |
| Controller | `Action.async`, convert `IO → Future` at boundary |
| IO → Future | `io.unsafeToFuture()(runtime)` with explicit `IORuntime`; `ExecutionContext` for `Future` chains |
| Routes wiring | `new Routes(errorHandler, ctrl1, ctrl2)` — arg order matches `conf/routes` declaration order |
| Config | `application.conf` + `${ENV_VAR}` substitution |

## Reference Files

| File | Content |
|------|---------|
| `reference/scala-play-config.md` | `build.sbt`, `plugins.sbt`, `application.conf`, `logback.xml` |
| `reference/scala-play-templates.md` | AppLoader, Controller, Service, Repository, Domain model, JSON Format, Test templates |

## Documentation Sources

Before generating code, verify against current docs:

| Source | Tool | What to check |
|--------|------|---------------|
| Play Framework | Context7 MCP (`playframework/playframework`) | Routes DSL, Action, Results, filters, `ApplicationLoader` API |
| Cats Effect | Context7 MCP (`typelevel/cats-effect`) | `IO`, `Ref`, `Resource`, `IORuntime`, `unsafeToFuture` |
| Cats Core | Context7 MCP (`typelevel/cats`) | `EitherT`, `Monad`, type class instances |
| iron | Context7 MCP (`Iltotore/iron`) | Refined type constraints, compile-time validation |

## Error Handling

- **Validation errors**: Check at service layer, return `Left(ValidationError(...))` — never throw
- **Not found**: Return `Left(NotFound(id))` — controller maps to 404
- **Unexpected errors**: Let `IO` propagate; Play's global error handler catches and returns 500
- **JSON parse failure**: Use `request.body.validate[T]` and fold on `JsError` → 400, `JsSuccess` → proceed
- Never swallow errors with `recover { case _ => }` — every catch must log and rethrow or return error state
