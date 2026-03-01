# Kotlin API — Conventions & Package Layout

## Package Layout

```
src/main/kotlin/com/company/myservice/
├── Application.kt                  # EngineMain entry point + module()
├── config/
│   ├── DIModules.kt                # Koin module definitions
│   ├── Database.kt                 # HikariCP + Exposed + Flyway setup
│   ├── Routing.kt                  # Mount all route extensions
│   ├── Serialization.kt            # ContentNegotiation plugin
│   ├── Security.kt                 # JWT auth plugin
│   ├── StatusPages.kt              # Global error → ProblemDetail mapping
│   └── Monitoring.kt               # Micrometer + call logging
├── common/
│   ├── DomainError.kt              # Sealed error hierarchy
│   └── Extensions.kt               # Shared extension functions
└── feature/
    └── user/                       # One package per domain feature
        ├── UserDomain.kt           # Domain model + value classes
        ├── UserDtos.kt             # Request/Response DTOs + mappers
        ├── UserRepository.kt       # Interface + Exposed implementation
        ├── UserService.kt          # Business logic, suspend funs
        └── UserRoutes.kt           # Ktor Route extension function

src/test/kotlin/com/company/myservice/
├── config/
│   └── TestDatabase.kt             # Testcontainers setup
└── feature/
    └── user/
        ├── UserServiceTest.kt      # Unit tests (MockK)
        └── UserRoutesTest.kt       # Integration tests (testApplication)

src/main/resources/
├── application.conf                # HOCON config
├── logback.xml
└── db/migration/
    ├── V1__create_users_table.sql
    └── V2__add_index.sql
```

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Classes | PascalCase | `UserService`, `CreateUserRequest` |
| Functions | camelCase | `findById`, `createUser` |
| Properties | camelCase | `firstName`, `createdAt` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Packages | lowercase, dot-separated | `com.company.myservice.feature.user` |
| Table objects | PascalCase + `Table` suffix | `UsersTable` |
| Value classes | PascalCase + `Id` suffix | `UserId`, `OrderId` |
| Route functions | camelCase + `Routes` suffix | `userRoutes()`, `orderRoutes()` |
| Test files | Subject + `Test` suffix | `UserServiceTest` |
| Config functions | `configure` + PascalCase | `configureDI()`, `configureRouting()` |

---

## Idiomatic Kotlin Checklist

### Prefer Kotlin idioms over Java habits

```kotlin
// ❌ Java habit
val result = if (user != null) user.email else "unknown"

// ✅ Kotlin idiom
val result = user?.email ?: "unknown"
```

```kotlin
// ❌ Java habit
val names = ArrayList<String>()
for (user in users) { names.add(user.firstName) }

// ✅ Kotlin idiom
val names = users.map { it.firstName }
```

```kotlin
// ❌ Java habit
if (response != null) { process(response) }

// ✅ Kotlin idiom
response?.let { process(it) }
// OR if you need the result:
val result = response?.let { transform(it) } ?: defaultValue
```

### Data classes — always immutable

```kotlin
// ✅ Immutable data class
data class User(
    val id: UserId,
    val email: String,
    val firstName: String,
)

// ❌ Mutable fields
data class User(
    var id: UUID,        // never var in domain models
    var email: String,
)
```

### Value classes for domain IDs — no primitive obsession

```kotlin
// ❌ Primitive obsession — UUID from wrong entity can be passed without compile error
fun findOrder(userId: UUID, orderId: UUID): Order

// ✅ Value classes — compile-time safety, zero runtime overhead
@JvmInline value class UserId(val value: UUID)
@JvmInline value class OrderId(val value: UUID)
fun findOrder(userId: UserId, orderId: OrderId): Order
```

### Sealed classes for exhaustive domain errors

```kotlin
// ✅ Sealed hierarchy — `when` is exhaustive, compiler enforces all cases
sealed class DomainError(message: String) : Exception(message) {
    data class NotFound(val id: UUID) : DomainError("Not found: $id")
    data class AlreadyExists(val field: String, val value: String) : DomainError("$field=$value exists")
    data class ValidationFailed(val errors: List<String>) : DomainError(errors.joinToString())
}

// Caller is forced to handle all cases:
when (error) {
    is DomainError.NotFound       -> call.respond(HttpStatusCode.NotFound, ...)
    is DomainError.AlreadyExists  -> call.respond(HttpStatusCode.Conflict, ...)
    is DomainError.ValidationFailed -> call.respond(HttpStatusCode.BadRequest, ...)
}
```

### Extension functions — use judiciously

```kotlin
// ✅ Good: mapping between layers
fun User.toResponse(): UserResponse = UserResponse(id = id.value.toString(), ...)

// ✅ Good: enriching third-party types
fun ApplicationCall.respondProblem(error: DomainError) { ... }

// ❌ Bad: business logic in extensions (hides complexity, hard to test)
fun User.calculateDiscount(): BigDecimal { /* 50 lines of logic */ }
```

### `apply`, `let`, `run`, `also`, `with` — scope functions

```kotlin
// apply: object configuration
val hikariConfig = HikariConfig().apply {
    jdbcUrl = url
    maximumPoolSize = 10
}

// also: side effects without changing the object
return repo.save(user).also {
    logger.info("Saved user id={}", user.id.value)
}

// let: nullable safety + scoping
val name = user?.let { "${it.firstName} ${it.lastName}" } ?: "Unknown"

// with: multiple calls on same receiver (avoid overuse)
with(call) {
    respond(HttpStatusCode.Created, response)
}
```

### Coroutines — always `suspend`, never block

```kotlin
// ❌ Blocks thread — starves Ktor's dispatcher
fun findById(id: UserId): User? = runBlocking { repo.findById(id) }

// ✅ Cooperative suspension
suspend fun findById(id: UserId): User? = repo.findById(id)
```

### String templates over concatenation

```kotlin
// ❌
logger.info("Created user with id " + user.id.value.toString())

// ✅
logger.info("Created user id={}", user.id.value)  // SLF4J lazy evaluation
// OR for structured logging:
logger.info("Created user", kv("userId", user.id.value))
```

### Default arguments over overloads

```kotlin
// ❌ Java-style overloads
fun findAll(): List<User> = findAll(0, 20)
fun findAll(page: Int): List<User> = findAll(page, 20)
fun findAll(page: Int, size: Int): List<User> { ... }

// ✅ Kotlin default arguments
suspend fun findAll(page: Int = 0, size: Int = 20): List<User> { ... }
```

---

## Layer Boundaries

```
Routes → Service → Repository → Database
  ↓          ↓           ↓
DTOs     Domain      Exposed
         types       DSL
```

- **Routes**: Only `receive<DTO>`, call service, `respond`. No business logic.
- **Service**: Business logic only. Returns `Either<DomainError, T>`. No HTTP concepts.
- **Repository**: DB access only. No business logic. Interface hides Exposed.
- **Domain**: Pure data. No framework dependencies. Immutable.

**Cross-layer rules:**
- Never expose Exposed `ResultRow` or `Table` objects above the repository layer
- Never use `HttpStatusCode` in service or repository layers
- Never expose domain entities directly in responses — always map to DTO first
