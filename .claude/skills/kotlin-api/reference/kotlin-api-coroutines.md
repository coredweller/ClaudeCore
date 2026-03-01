# Kotlin API — Coroutines & Concurrency Patterns

## Dispatcher Rules for Ktor + Exposed

| Work Type | Dispatcher | Why |
|-----------|-----------|-----|
| Route handlers | `Dispatchers.IO` (Ktor default) | Network I/O |
| Exposed DB queries | `Dispatchers.IO` via `newSuspendedTransaction` | JDBC is blocking |
| CPU computation | `Dispatchers.Default` | Thread pool sized to CPU cores |
| Pure suspend (no blocking I/O) | Inherit caller's dispatcher | No switch needed |

**Critical rule:** Never call blocking JDBC directly in a coroutine without `newSuspendedTransaction` or `withContext(Dispatchers.IO)`. Blocking the event loop adds latency to every concurrent request.

---

## `newSuspendedTransaction` — Exposed + Coroutines

```kotlin
// ✅ Correct: Exposed's coroutine-aware transaction boundary
suspend fun findById(id: UserId): User? =
    newSuspendedTransaction(Dispatchers.IO) {
        UsersTable.selectAll()
            .where { UsersTable.id eq id.value }
            .singleOrNull()
            ?.toUser()
    }

// ❌ Wrong: transaction {} is synchronous — blocks the thread
suspend fun findById(id: UserId): User? =
    transaction {          // blocks Ktor's coroutine dispatcher
        UsersTable.selectAll()...
    }
```

---

## Structured Concurrency in Services

### Parallel independent queries

```kotlin
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

// Run two independent DB queries in parallel, fail fast if either fails
suspend fun getUserDashboard(userId: UserId): Dashboard =
    coroutineScope {
        val userDeferred  = async { userRepo.findById(userId) }
        val ordersDeferred = async { orderRepo.findByUser(userId) }

        val user   = userDeferred.await() ?: throw DomainError.NotFound(userId.value)
        val orders = ordersDeferred.await()

        Dashboard(user = user.toResponse(), orders = orders.map { it.toResponse() })
    }
// coroutineScope cancels all children if one fails — structured concurrency guarantee
```

### Sequential with short-circuit

```kotlin
// Use Either + fold for clean early return without exceptions
suspend fun transferFunds(
    fromId: AccountId,
    toId: AccountId,
    amount: BigDecimal,
): Either<DomainError, Unit> {
    val from = accountRepo.findById(fromId) ?: return DomainError.NotFound(fromId.value).left()
    val to   = accountRepo.findById(toId)   ?: return DomainError.NotFound(toId.value).left()

    if (from.balance < amount) return DomainError.ValidationFailed(listOf("Insufficient funds")).left()

    accountRepo.debit(from.id, amount)
    accountRepo.credit(to.id, amount)
    return Unit.right()
}
```

---

## Flow — Streaming & Pagination

### Repository returning `Flow<T>`

```kotlin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

// For large result sets — stream rows instead of loading all into memory
fun findAllAsFlow(): Flow<User> = flow {
    newSuspendedTransaction(Dispatchers.IO) {
        UsersTable.selectAll().forEach { emit(it.toUser()) }
    }
}
```

### Service consuming `Flow<T>`

```kotlin
// Filter + transform in service layer
fun findActiveUsersFlow(): Flow<UserResponse> =
    repo.findAllAsFlow()
        .filter { it.isActive }
        .map { it.toResponse() }
```

### Ktor SSE (Server-Sent Events) with Flow

```kotlin
import io.ktor.server.response.respondTextWriter
import io.ktor.http.ContentType

get("/api/v1/events") {
    call.respondTextWriter(ContentType.Text.EventStream) {
        eventFlow.collect { event ->
            write("data: ${Json.encodeToString(event)}\n\n")
            flush()
        }
    }
}
```

---

## Timeout & Cancellation

```kotlin
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException

suspend fun findWithTimeout(id: UserId): User? =
    try {
        withTimeout(5_000L) {     // 5 seconds max
            repo.findById(id)
        }
    } catch (e: TimeoutCancellationException) {
        logger.warn("findById timed out for id={}", id.value)
        throw DomainError.ValidationFailed(listOf("Request timed out"))
    }
```

---

## Retry with Exponential Backoff

```kotlin
import kotlinx.coroutines.delay
import kotlin.math.min

suspend fun <T> retryWithBackoff(
    times: Int = 3,
    initialDelayMs: Long = 100,
    maxDelayMs: Long = 5_000,
    factor: Double = 2.0,
    block: suspend () -> T,
): T {
    var currentDelay = initialDelayMs
    repeat(times - 1) { attempt ->
        try {
            return block()
        } catch (e: Exception) {
            logger.warn("Attempt {} failed: {}", attempt + 1, e.message)
        }
        delay(currentDelay)
        currentDelay = min((currentDelay * factor).toLong(), maxDelayMs)
    }
    return block()   // last attempt — let exception propagate
}

// Usage:
suspend fun findWithRetry(id: UserId): User? =
    retryWithBackoff(times = 3) { repo.findById(id) }
```

---

## Coroutine Scope in Ktor Lifecycle

```kotlin
// Application-scoped background job — tied to server lifecycle
fun Application.configureBackgroundJobs() {
    val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    environment.monitor.subscribe(ApplicationStopping) {
        scope.cancel()    // Clean shutdown — cancel all children
    }

    scope.launch {
        while (isActive) {
            runCatching { cleanupExpiredSessions() }
                .onFailure { logger.error("Cleanup failed", it) }
            delay(60_000L)  // Run every 60 seconds
        }
    }
}
```

**Rules:**
- Always use `SupervisorJob()` for independent background tasks — one failure doesn't cancel siblings
- Always cancel the scope on `ApplicationStopping` — prevents goroutine/coroutine leaks
- Wrap background loops in `runCatching` to prevent one bad iteration from killing the loop

---

## Channel — Producer/Consumer

```kotlin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

// Bounded channel — backpressure when consumer is slow
val channel = Channel<DomainEvent>(capacity = 64)

// Producer
launch {
    userCreatedEvents.collect { event ->
        channel.send(event)    // suspends if channel is full — backpressure
    }
}

// Consumer
launch {
    for (event in channel) {
        eventHandler.handle(event)
    }
}
```

---

## Anti-Patterns

```kotlin
// ❌ GlobalScope — no structured concurrency, leaks on shutdown
GlobalScope.launch { doWork() }

// ✅ Use application scope or coroutineScope
scope.launch { doWork() }

// ❌ runBlocking inside a suspend fun — deadlocks event loop
suspend fun getData() = runBlocking { repo.find() }

// ✅ Just call the suspend function directly
suspend fun getData() = repo.find()

// ❌ Catching CancellationException and not rethrowing — breaks cancellation
try { ... } catch (e: Exception) { logger.error(e) /* swallowed */ }

// ✅ Always rethrow CancellationException
try { ... } catch (e: CancellationException) { throw e }
            catch (e: Exception) { logger.error("Failed", e); throw e }

// ❌ withContext(Dispatchers.IO) for Exposed — use newSuspendedTransaction instead
withContext(Dispatchers.IO) { transaction { ... } }

// ✅
newSuspendedTransaction(Dispatchers.IO) { ... }
```
