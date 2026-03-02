# Kotlin API — Code Templates

Production-ready templates for Kotlin 2.x + Ktor 3.x development.

---

## `Application.kt` — Entry Point

```kotlin
package com.company.myservice

import com.company.myservice.config.configureDatabase
import com.company.myservice.config.configureDI
import com.company.myservice.config.configureMonitoring
import com.company.myservice.config.configureRouting
import com.company.myservice.config.configureSecurity
import com.company.myservice.config.configureSerialization
import io.ktor.server.application.Application
import io.ktor.server.netty.EngineMain

fun main(args: Array<String>) = EngineMain.main(args)

fun Application.module() {
    configureDI()
    configureSerialization()
    configureSecurity()
    configureMonitoring()
    configureDatabase()
    configureRouting()
}
```

---

## `config/DIModules.kt` — Koin Module Wiring

```kotlin
package com.company.myservice.config

import com.company.myservice.feature.user.UserRepository
import com.company.myservice.feature.user.UserRepositoryImpl
import com.company.myservice.feature.user.UserService
import io.ktor.server.application.Application
import io.ktor.server.application.install
import org.koin.dsl.module
import org.koin.ktor.plugin.Koin
import org.koin.logger.slf4jLogger

val appModule = module {
    single<UserRepository> { UserRepositoryImpl() }
    single { UserService(get()) }
}

fun Application.configureDI() {
    install(Koin) {
        slf4jLogger()
        modules(appModule)
    }
}
```

---

## `config/Serialization.kt`

```kotlin
package com.company.myservice.config

import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import kotlinx.serialization.json.Json

fun Application.configureSerialization() {
    install(ContentNegotiation) {
        json(Json {
            prettyPrint = false
            isLenient = false
            ignoreUnknownKeys = false
            encodeDefaults = true
        })
    }
}
```

---

## `config/Routing.kt` — Route Mounting

```kotlin
package com.company.myservice.config

import com.company.myservice.feature.user.UserService
import com.company.myservice.feature.user.userRoutes
import io.ktor.server.application.Application
import io.ktor.server.routing.routing
import org.koin.ktor.ext.inject

// IMPORTANT: inject services here at Application scope, NOT inside Route extensions.
// koin-ktor 4.0.1 + Ktor 3.x has a known NoClassDefFoundError when calling inject()
// inside a Route extension function (RoutingKt class not found at runtime).
fun Application.configureRouting() {
    val userService: UserService by inject()

    routing {
        userRoutes(userService)
        // add more route extensions here
    }
}
```

---

## `config/StatusPages.kt` — Error Handling (RFC 9457)

```kotlin
package com.company.myservice.config

import com.company.myservice.common.DomainError
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import kotlinx.serialization.Serializable
import org.slf4j.LoggerFactory

private val logger = LoggerFactory.getLogger("StatusPages")

@Serializable
data class ProblemDetail(
    val type: String,
    val title: String,
    val status: Int,
    val detail: String,
)

fun Application.configureStatusPages() {
    install(StatusPages) {
        exception<DomainError.NotFound> { call, cause ->
            call.respond(
                HttpStatusCode.NotFound,
                ProblemDetail("not-found", "Resource Not Found", 404, cause.message ?: "Not found"),
            )
        }
        exception<DomainError.AlreadyExists> { call, cause ->
            call.respond(
                HttpStatusCode.Conflict,
                ProblemDetail("conflict", "Resource Already Exists", 409, cause.message ?: "Conflict"),
            )
        }
        exception<DomainError.ValidationFailed> { call, cause ->
            call.respond(
                HttpStatusCode.BadRequest,
                ProblemDetail("validation-error", "Validation Failed", 400, cause.message ?: "Bad request"),
            )
        }
        exception<Throwable> { call, cause ->
            logger.error("Unhandled exception", cause)
            call.respond(
                HttpStatusCode.InternalServerError,
                ProblemDetail("internal-error", "Internal Server Error", 500, "An unexpected error occurred"),
            )
        }
    }
}
```

---

## `common/DomainError.kt`

```kotlin
package com.company.myservice.common

import java.util.UUID

sealed class DomainError(message: String) : Exception(message) {
    data class NotFound(val id: UUID) : DomainError("Resource with id $id not found")
    data class AlreadyExists(val field: String, val value: String) :
        DomainError("$field '$value' already exists")
    data class ValidationFailed(val errors: List<String>) :
        DomainError(errors.joinToString("; "))
}
```

---

## `feature/user/UserDomain.kt` — Domain Model

```kotlin
package com.company.myservice.feature.user

import java.time.Instant
import java.util.UUID

// Value class — zero-cost at runtime, type-safe at compile time
@JvmInline
value class UserId(val value: UUID) {
    companion object {
        fun new() = UserId(UUID.randomUUID())
        fun from(value: String) = UserId(UUID.fromString(value))
    }
}

data class User(
    val id: UserId,
    val email: String,
    val firstName: String,
    val lastName: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)
```

---

## `feature/user/UserDtos.kt` — Request/Response DTOs

```kotlin
package com.company.myservice.feature.user

import io.konform.validation.Validation
import io.konform.validation.jsonschema.maxLength
import io.konform.validation.jsonschema.minLength
import io.konform.validation.jsonschema.pattern
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

@Serializable
data class CreateUserRequest(
    val email: String,
    val firstName: String,
    val lastName: String,
) {
    companion object {
        val validate = Validation {
            CreateUserRequest::email {
                minLength(1) hint "Email must not be blank"
                maxLength(255) hint "Email must not exceed 255 characters"
                pattern(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) hint "Must be a valid email address"
            }
            CreateUserRequest::firstName {
                minLength(1) hint "First name must not be blank"
                maxLength(100) hint "First name must not exceed 100 characters"
            }
            CreateUserRequest::lastName {
                minLength(1) hint "Last name must not be blank"
                maxLength(100) hint "Last name must not exceed 100 characters"
            }
        }
    }
}

@Serializable
data class UserResponse(
    val id: String,        // UUID as String for JSON; avoid @Serializable on UUID
    val email: String,
    val firstName: String,
    val lastName: String,
    val createdAt: String, // ISO-8601
    val updatedAt: String,
)

fun User.toResponse() = UserResponse(
    id = id.value.toString(),
    email = email,
    firstName = firstName,
    lastName = lastName,
    createdAt = createdAt.toString(),
    updatedAt = updatedAt.toString(),
)
```

---

## `feature/user/UserRepository.kt` — Repository Interface + Exposed Impl

```kotlin
package com.company.myservice.feature.user

import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.javatime.timestamp   // exposed-java-time; yields java.time.Instant directly
import org.jetbrains.exposed.sql.transactions.experimental.newSuspendedTransaction
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.ResultRow
import java.util.UUID

// Repository interface — keep I/O decoupled from implementation
interface UserRepository {
    suspend fun findById(id: UserId): User?
    suspend fun findAll(): List<User>
    suspend fun save(user: User): User
    suspend fun existsByEmail(email: String): Boolean
}

// Exposed table definition
object UsersTable : Table("users") {
    val id        = uuid("id")
    val email     = varchar("email", 255).uniqueIndex()
    val firstName = varchar("first_name", 100)
    val lastName  = varchar("last_name", 100)
    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")

    override val primaryKey = PrimaryKey(id)
}

class UserRepositoryImpl : UserRepository {

    override suspend fun findById(id: UserId): User? =
        newSuspendedTransaction {
            UsersTable.selectAll()
                .where { UsersTable.id eq id.value }
                .singleOrNull()
                ?.toUser()
        }

    override suspend fun findAll(): List<User> =
        newSuspendedTransaction {
            UsersTable.selectAll().map { it.toUser() }
        }

    override suspend fun save(user: User): User {
        newSuspendedTransaction {
            UsersTable.insert {
                it[id]        = user.id.value
                it[email]     = user.email
                it[firstName] = user.firstName
                it[lastName]  = user.lastName
                it[createdAt] = user.createdAt
                it[updatedAt] = user.updatedAt
            }
        }
        return user
    }

    override suspend fun existsByEmail(email: String): Boolean =
        newSuspendedTransaction {
            UsersTable.selectAll()
                .where { UsersTable.email eq email }
                .count() > 0
        }

    private fun ResultRow.toUser() = User(
        id        = UserId(this[UsersTable.id]),
        email     = this[UsersTable.email],
        firstName = this[UsersTable.firstName],
        lastName  = this[UsersTable.lastName],
        createdAt = this[UsersTable.createdAt],  // already java.time.Instant via exposed-java-time
        updatedAt = this[UsersTable.updatedAt],
    )
}
```

---

## `feature/user/UserService.kt`

```kotlin
package com.company.myservice.feature.user

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import com.company.myservice.common.DomainError
import org.slf4j.LoggerFactory
import java.time.Instant

class UserService(private val repo: UserRepository) {

    private val logger = LoggerFactory.getLogger(UserService::class.java)

    suspend fun findById(id: UserId): Either<DomainError, User> {
        logger.debug("Finding user by id={}", id.value)
        return repo.findById(id)?.right()
            ?: DomainError.NotFound(id.value).left()
    }

    suspend fun findAll(): List<User> = repo.findAll()

    suspend fun create(request: CreateUserRequest): Either<DomainError, User> {
        val validationResult = CreateUserRequest.validate(request)
        if (validationResult.errors.isNotEmpty()) {
            val messages = validationResult.errors.map { it.message }
            logger.warn("Validation failed for create user: {}", messages)
            return DomainError.ValidationFailed(messages).left()
        }

        if (repo.existsByEmail(request.email)) {
            logger.warn("User with email={} already exists", request.email)
            return DomainError.AlreadyExists("email", request.email).left()
        }

        val now = Instant.now()
        val user = User(
            id        = UserId.new(),
            email     = request.email,
            firstName = request.firstName,
            lastName  = request.lastName,
            createdAt = now,
            updatedAt = now,
        )
        return repo.save(user).also {
            logger.info("Created user id={}", user.id.value)
        }.right()
    }
}
```

---

## `feature/user/UserRoutes.kt` — Ktor Routes

```kotlin
package com.company.myservice.feature.user

import com.company.myservice.common.DomainError
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route

// Service is injected in Routing.kt (Application scope) and passed as a parameter.
// Do NOT call inject() inside a Route extension — koin-ktor 4.0.1 + Ktor 3.x throws
// NoClassDefFoundError: RoutingKt at runtime.
fun Route.userRoutes(service: UserService) {
    route("/api/v1/users") {
        get {
            val users = service.findAll()
            call.respond(users.map { it.toResponse() })
        }

        get("/{id}") {
            val id = UserId.from(
                call.parameters["id"] ?: return@get call.respond(HttpStatusCode.BadRequest)
            )
            service.findById(id).fold(
                ifLeft = { error -> throw error },
                ifRight = { user -> call.respond(user.toResponse()) },
            )
        }

        post {
            val request = call.receive<CreateUserRequest>()
            service.create(request).fold(
                ifLeft = { error -> throw error },
                ifRight = { user -> call.respond(HttpStatusCode.Created, user.toResponse()) },
            )
        }
    }
}
```

---

## `config/Database.kt` — HikariCP + Exposed + Flyway

```kotlin
package com.company.myservice.config

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.server.application.Application
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.sql.Database
import org.slf4j.LoggerFactory

private val logger = LoggerFactory.getLogger("Database")

fun Application.configureDatabase() {
    val dbConfig = environment.config.config("database")
    val poolConfig = dbConfig.config("pool")

    val hikariConfig = HikariConfig().apply {
        jdbcUrl = dbConfig.property("url").getString()
        username = dbConfig.property("user").getString()
        password = dbConfig.property("password").getString()
        maximumPoolSize = poolConfig.property("maximum-pool-size").getString().toInt()
        minimumIdle = poolConfig.property("minimum-idle").getString().toInt()
        connectionTimeout = poolConfig.property("connection-timeout-ms").getString().toLong()
        driverClassName = "org.postgresql.Driver"
        isAutoCommit = false
        transactionIsolation = "TRANSACTION_REPEATABLE_READ"
    }

    val dataSource = HikariDataSource(hikariConfig)

    // Run Flyway migrations
    Flyway.configure()
        .dataSource(dataSource)
        .locations("classpath:db/migration")
        .load()
        .migrate()
        .also { result ->
            logger.info("Flyway applied {} migration(s)", result.migrationsExecuted)
        }

    Database.connect(dataSource)
    logger.info("Database connected successfully")
}
```

---

## Flyway Migration Template

```sql
-- V1__create_users_table.sql
CREATE TABLE users (
    id          UUID        NOT NULL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    first_name  VARCHAR(100) NOT NULL,
    last_name   VARCHAR(100) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_users_email ON users (email);
```
