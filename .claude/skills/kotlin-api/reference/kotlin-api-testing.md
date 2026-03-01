# Kotlin API — Testing Patterns

Stack: **Kotest 5.9** + **MockK 1.13** + **Testcontainers** + Ktor's `testApplication`

---

## Test Dependencies (`build.gradle.kts`)

```kotlin
testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
testImplementation("io.kotest:kotest-runner-junit5:5.9.1")
testImplementation("io.kotest:kotest-assertions-core:5.9.1")
testImplementation("io.kotest:kotest-assertions-arrow:2.0.0")        // Either assertions
testImplementation("io.mockk:mockk:1.13.14")
testImplementation("org.testcontainers:postgresql:1.20.4")
testImplementation("io.insert-koin:koin-test:4.0.1")
testImplementation("io.insert-koin:koin-test-junit5:4.0.1")
```

---

## Unit Test — Service with MockK

```kotlin
package com.company.myservice.feature.user

import com.company.myservice.common.DomainError
import io.kotest.assertions.arrow.core.shouldBeLeft
import io.kotest.assertions.arrow.core.shouldBeRight
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import java.time.Instant
import java.util.UUID

class UserServiceTest : DescribeSpec({

    val repo = mockk<UserRepository>()
    val service = UserService(repo)

    describe("findById") {
        context("when user exists") {
            val userId = UserId.new()
            val user = User(
                id = userId,
                email = "alice@example.com",
                firstName = "Alice",
                lastName = "Smith",
                createdAt = Instant.now(),
                updatedAt = Instant.now(),
            )

            beforeEach {
                coEvery { repo.findById(userId) } returns user
            }

            it("returns Right(User)") {
                val result = service.findById(userId)
                result.shouldBeRight()
                result.value.email shouldBe "alice@example.com"
            }
        }

        context("when user does not exist") {
            val userId = UserId.new()

            beforeEach {
                coEvery { repo.findById(userId) } returns null
            }

            it("returns Left(NotFound)") {
                val result = service.findById(userId)
                result.shouldBeLeft()
                result.value shouldBe DomainError.NotFound(userId.value)
            }
        }
    }

    describe("create") {
        val validRequest = CreateUserRequest(
            email = "bob@example.com",
            firstName = "Bob",
            lastName = "Jones",
        )

        context("when email is not taken") {
            beforeEach {
                coEvery { repo.existsByEmail(validRequest.email) } returns false
                coEvery { repo.save(any()) } answers { firstArg() }
            }

            it("returns Right(User) and saves to repository") {
                val result = service.create(validRequest)
                result.shouldBeRight()
                result.value.email shouldBe validRequest.email
                coVerify(exactly = 1) { repo.save(any()) }
            }
        }

        context("when email is already taken") {
            beforeEach {
                coEvery { repo.existsByEmail(validRequest.email) } returns true
            }

            it("returns Left(AlreadyExists)") {
                val result = service.create(validRequest)
                result.shouldBeLeft()
                result.value shouldBe DomainError.AlreadyExists("email", validRequest.email)
                coVerify(exactly = 0) { repo.save(any()) }
            }
        }

        context("when request is invalid") {
            val invalidRequest = CreateUserRequest(email = "not-an-email", firstName = "", lastName = "Jones")

            it("returns Left(ValidationFailed) without touching repository") {
                val result = service.create(invalidRequest)
                result.shouldBeLeft()
                val error = result.value as DomainError.ValidationFailed
                error.errors.isNotEmpty() shouldBe true
                coVerify(exactly = 0) { repo.existsByEmail(any()) }
            }
        }
    }
})
```

---

## Integration Test — Ktor Routes with `testApplication`

```kotlin
package com.company.myservice.feature.user

import com.company.myservice.config.configureDI
import com.company.myservice.config.configureRouting
import com.company.myservice.config.configureSerialization
import com.company.myservice.config.configureStatusPages
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.testing.testApplication
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.serialization.json.Json
import org.koin.dsl.module
import org.koin.ktor.plugin.Koin
import java.time.Instant

class UserRoutesTest : DescribeSpec({

    val mockRepo = mockk<UserRepository>()
    val testModule = module {
        single<UserRepository> { mockRepo }
        single { UserService(get()) }
    }

    fun testApp(block: suspend io.ktor.client.HttpClient.() -> Unit) = testApplication {
        application {
            install(Koin) { modules(testModule) }
            configureSerialization()
            configureStatusPages()
            configureRouting()
        }
        val client = createClient {
            install(ContentNegotiation) { json() }
        }
        client.block()
    }

    describe("GET /api/v1/users") {
        it("returns 200 with list of users") = testApp {
            val userId = UserId.new()
            val now = Instant.now()
            coEvery { mockRepo.findAll() } returns listOf(
                User(userId, "alice@example.com", "Alice", "Smith", now, now)
            )

            val response = get("/api/v1/users")

            response.status shouldBe HttpStatusCode.OK
            val body = response.body<List<UserResponse>>()
            body.size shouldBe 1
            body[0].email shouldBe "alice@example.com"
        }
    }

    describe("GET /api/v1/users/{id}") {
        it("returns 200 when user found") = testApp {
            val userId = UserId.new()
            val now = Instant.now()
            coEvery { mockRepo.findById(userId) } returns
                User(userId, "alice@example.com", "Alice", "Smith", now, now)

            val response = get("/api/v1/users/${userId.value}")

            response.status shouldBe HttpStatusCode.OK
            val body = response.body<UserResponse>()
            body.id shouldBe userId.value.toString()
        }

        it("returns 404 when user not found") = testApp {
            val userId = UserId.new()
            coEvery { mockRepo.findById(userId) } returns null

            val response = get("/api/v1/users/${userId.value}")

            response.status shouldBe HttpStatusCode.NotFound
        }
    }

    describe("POST /api/v1/users") {
        it("returns 201 when request is valid") = testApp {
            val request = CreateUserRequest("bob@example.com", "Bob", "Jones")
            coEvery { mockRepo.existsByEmail(any()) } returns false
            coEvery { mockRepo.save(any()) } answers { firstArg() }

            val response = post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(request)
            }

            response.status shouldBe HttpStatusCode.Created
        }

        it("returns 400 when email is invalid") = testApp {
            val request = CreateUserRequest("not-an-email", "Bob", "Jones")

            val response = post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(request)
            }

            response.status shouldBe HttpStatusCode.BadRequest
        }
    }
})
```

---

## Testcontainers — Database Integration Test

```kotlin
package com.company.myservice.config

import io.kotest.core.spec.style.DescribeSpec
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SchemaUtils
import org.jetbrains.exposed.sql.transactions.transaction
import org.testcontainers.containers.PostgreSQLContainer

object TestDatabase {
    private val container = PostgreSQLContainer("postgres:17-alpine").apply {
        withDatabaseName("testdb")
        withUsername("test")
        withPassword("test")
        start()
    }

    fun connect(): Database = Database.connect(
        url = container.jdbcUrl,
        driver = "org.postgresql.Driver",
        user = container.username,
        password = container.password,
    )
}

// Base spec for DB integration tests — creates + drops tables per test class
abstract class DatabaseSpec(body: DescribeSpec.() -> Unit) : DescribeSpec({
    val db = TestDatabase.connect()

    beforeSpec {
        transaction(db) {
            SchemaUtils.create(UsersTable)
        }
    }

    afterSpec {
        transaction(db) {
            SchemaUtils.drop(UsersTable)
        }
    }

    body()
})
```

```kotlin
class UserRepositoryImplTest : DatabaseSpec({

    val repo = UserRepositoryImpl()

    describe("save and findById") {
        it("round-trips a user correctly") {
            val now = Instant.now()
            val user = User(UserId.new(), "alice@example.com", "Alice", "Smith", now, now)

            repo.save(user)
            val found = repo.findById(user.id)

            found?.email shouldBe "alice@example.com"
            found?.firstName shouldBe "Alice"
        }
    }

    describe("existsByEmail") {
        it("returns false for unknown email") {
            repo.existsByEmail("unknown@example.com") shouldBe false
        }

        it("returns true after saving a user with that email") {
            val now = Instant.now()
            val user = User(UserId.new(), "exists@example.com", "X", "Y", now, now)
            repo.save(user)

            repo.existsByEmail("exists@example.com") shouldBe true
        }
    }
})
```

---

## MockK Cheat Sheet

```kotlin
// Stub a suspend function
coEvery { repo.findById(any()) } returns null
coEvery { repo.save(any()) } answers { firstArg() }   // return the first argument

// Stub with argument matching
coEvery { repo.findById(match { it.value == knownId }) } returns user

// Verify calls
coVerify(exactly = 1) { repo.save(any()) }
coVerify(exactly = 0) { repo.existsByEmail(any()) }
coVerify(atLeast = 1) { repo.findAll() }

// Capture argument
val slot = slot<User>()
coEvery { repo.save(capture(slot)) } answers { slot.captured }
// after the call:
slot.captured.email shouldBe "expected@example.com"

// Relaxed mock — returns default values for unstubbed calls
val repo = mockk<UserRepository>(relaxed = true)

// Spy on a real object
val service = spyk(UserService(repo))
coVerify { service.findById(userId) }
```

---

## Test Naming Convention

```
describe("ServiceOrRoute method name") {
    context("when [condition]") {
        it("[expected outcome]") { ... }
    }
}

// Examples:
describe("UserService.create") {
    context("when email is already taken") {
        it("returns Left(AlreadyExists)") { ... }
    }
    context("when email is valid and available") {
        it("saves the user and returns Right(User)") { ... }
    }
}
```

---

## CI Test Command

```bash
./gradlew test --tests "*Test" --info
./gradlew test -Dkotest.tags="!Integration"    # Skip Testcontainers tests locally
```
