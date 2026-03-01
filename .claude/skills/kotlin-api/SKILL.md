---
name: kotlin-api
description: Skill for Kotlin 2.x + Ktor 3.x REST API development with Exposed ORM, Koin DI, coroutines, and Kotest. Activate when creating Ktor routes, services, repositories, domain models, or tests.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Kotlin 2.x + Ktor 3.x REST API Skill

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Framework | Ktor 3.x | Kotlin-native, coroutines-first, no reflection overhead |
| DI | Koin 4.x | Lightweight Kotlin DSL, no annotation processing |
| ORM | Exposed 0.57.x | JetBrains-maintained, idiomatic Kotlin DSL |
| DB migrations | Flyway | Battle-tested, integrates cleanly with Exposed |
| Serialization | kotlinx.serialization | Official Kotlin library, no reflection |
| Validation | Konform | Functional, type-safe, no annotation magic |
| Testing | Kotest + MockK | Kotlin-first, coroutine-aware |
| Linting | Detekt + Ktlint | Static analysis + style enforcement |

## Process

1. Read `reference/kotlin-api-config.md` — exact `build.gradle.kts`, `application.conf`, plugin setup
2. Read `reference/kotlin-api-templates.md` — Route, Service, Repository, Domain, Serializer templates
3. Scaffold Koin module wiring (`Application.kt` + `DIModules.kt`) **first** — everything else depends on it
4. Use `suspend fun` for ALL I/O operations; use `Flow` for streaming/pagination
5. Run `./gradlew detekt ktlintCheck test` before finishing

## Common Commands

```bash
./gradlew run                  # Start dev server (port 8080, uses application.conf)
./gradlew test                 # Run all tests
./gradlew build                # Build fat JAR
./gradlew detekt               # Static analysis
./gradlew ktlintFormat         # Format all sources
./gradlew ktlintCheck          # Check formatting (CI gate)
./gradlew dependencies         # Show dependency tree
./gradlew shadowJar            # Build shadow (uber) JAR for Docker
```

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| Domain IDs | `@JvmInline value class UserId(val value: UUID)` |
| Errors | Sealed class hierarchy `DomainError` |
| Repository | Interface with `suspend` methods; Exposed impl |
| Service | `suspend fun` returning `Either<DomainError, T>` (Arrow) |
| Route | `Route.userRoutes()` extension function, mounted in `Application.kt` |
| Request DTO | `@Serializable data class` with Konform validation |
| Response DTO | `@Serializable data class` — never expose domain/entity directly |
| Error response | Ktor `StatusPages` plugin → RFC 9457 `ProblemDetail` JSON |
| Config | `application.conf` (HOCON) with `${?ENV_VAR}` substitution |
| Migrations | Flyway in `src/main/resources/db/migration/` |

## Reference Files

| File | Content |
|------|---------|
| `reference/kotlin-api-config.md` | `build.gradle.kts`, `settings.gradle.kts`, `application.conf`, `logback.xml`, Docker setup |
| `reference/kotlin-api-templates.md` | Application, Module, Route, Service, Repository, Domain, DTO, Migration templates |
| `reference/kotlin-api-conventions.md` | Package layout, naming rules, idiomatic Kotlin checklist |
| `reference/kotlin-api-coroutines.md` | Coroutine scopes, Flow patterns, structured concurrency, dispatcher rules |
| `reference/kotlin-api-testing.md` | Kotest specs, MockK patterns, Testcontainers, `testApplication` integration tests |
| `reference/kotlin-api-review-checklist.md` | Review checklist (used by `kotlin-expert` agent) |

## Documentation Sources

Before generating code, verify against current docs:

| Source | Tool | What to check |
|--------|------|---------------|
| Ktor | Context7 MCP (`ktorio/ktor`) | Routing DSL, plugins, ApplicationCall, StatusPages |
| Exposed | Context7 MCP (`JetBrains/Exposed`) | DSL vs DAO, transactions, `suspendedTransaction` |
| Koin | Context7 MCP (`InsertKoinIO/koin`) | `module {}` DSL, `inject()`, Ktor plugin |
| Kotlin Coroutines | Context7 MCP (`Kotlin/kotlinx.coroutines`) | `Flow`, `Channel`, `CoroutineScope`, dispatchers |
| kotlinx.serialization | Context7 MCP (`Kotlin/kotlinx.serialization`) | `@Serializable`, custom serializers, polymorphism |
| Arrow | Context7 MCP (`arrow-kt/arrow`) | `Either`, `raise`, `Effect` |

## Error Handling

- **Validation errors**: Validate at route boundary with Konform → `StatusPages` maps to `400 Bad Request`
- **Not found**: Return `Left(DomainError.NotFound(id))` from service → `StatusPages` maps to `404`
- **Conflict**: Return `Left(DomainError.AlreadyExists(...))` → `StatusPages` maps to `409`
- **Unexpected errors**: Let exception propagate to `StatusPages` → log + return `500` with `ProblemDetail`
- Never swallow with `catch { }` — every catch block must log and rethrow or return `Left`
- Use `Either` from Arrow for expected failures; exceptions only for truly unexpected states
