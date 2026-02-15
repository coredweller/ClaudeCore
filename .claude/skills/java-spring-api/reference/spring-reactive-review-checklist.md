# Spring Reactive Code Review Checklist

## Issue Severity

| Level | Label | Criteria | Action |
|-------|-------|----------|--------|
| **P0** | CRITICAL | Production blocker: blocking calls, security holes, data loss | Must fix before merge |
| **P1** | HIGH | Major impact: missing resilience, <90% coverage, no error handling | Fix in current sprint |
| **P2** | MEDIUM | Code quality: duplication, complexity >10, missing docs | Fix in next sprint |
| **P3** | LOW | Style: naming, optional optimizations, minor improvements | Backlog |

## 10 Review Areas

### P0 — Review First

**1. Reactive Correctness**
- NO `.block()`, `.blockFirst()`, `.blockLast()`, `Thread.sleep()`
- All methods return `Mono<T>` or `Flux<T>`
- `ReactiveCrudRepository` (not JpaRepository), `WebClient` (not RestTemplate), R2DBC (not JPA)
- Request bodies are plain DTOs, NOT `Mono<RequestDTO>`
- No premature `.subscribe()` — let the framework subscribe

**2. Resilience Patterns**
- All external calls (DB, HTTP, messaging) have resilience protection
- Programmatic Resilience4j only: registry injection, `.transformDeferred()` with `CircuitBreakerOperator` / `RetryOperator` / `TimeLimiterOperator`
- NO annotation-based patterns (`@CircuitBreaker`, `@Retry`, `@TimeLimiter` are forbidden)
- Operator ordering: Retry → CircuitBreaker → RateLimiter → TimeLimiter → Bulkhead (outermost first)
- Fallback methods handle `CallNotPermittedException` specifically
- Timeout configured on all external calls

**3. Security**
- Input validation: `@Valid` on request bodies, `jakarta.validation` on DTO fields
- No hardcoded secrets, API keys, or passwords
- Security headers configured (CSP, X-Frame-Options, X-Content-Type-Options)
- Sensitive data masked in logs
- CORS properly scoped (not wildcard `*` in production)

**4. Error Handling**
- Exception hierarchy extends a base `ApplicationException`
- Global error handler produces structured error responses
- `switchIfEmpty(Mono.error(...))` for not-found cases
- `.onErrorMap()` or `.onErrorResume()` for error translation
- No swallowed exceptions (empty catch blocks or `.onErrorResume(e -> Mono.empty())`)

**5. Testing**
- StepVerifier for all reactive streams
- No `.block()` in tests
- `@WebFluxTest` for controllers, `@ExtendWith(MockitoExtension.class)` for services
- Resilience patterns tested: happy path + circuit open + retry + timeout
- Coverage >= 90% line, 80% branch

### P1 — Review Second

**6. Java 21 Patterns**
- Records for DTOs and value objects (not Lombok `@Data` classes)
- Pattern matching in `instanceof` checks
- Switch expressions (not if/else chains for type dispatch)
- Text blocks for multi-line strings (SQL, JSON)

**7. Performance**
- Connection pools configured (R2DBC, WebClient)
- No N+1 queries (use joins or batch fetches)
- `Mono.zip()` for independent parallel calls
- Backpressure handled for `Flux` streams

**8. Observability**
- Structured logging with correlation IDs
- Meaningful log messages at appropriate levels
- Health indicators for critical dependencies
- Metrics for business-relevant operations

### P2 — Review Last

**9. Architecture**
- Layered: controller → service → repository
- Constructor injection (not `@Autowired` field injection)
- Configuration externalized via `@ConfigurationProperties`
- No business logic in controllers

**10. Documentation**
- Public APIs have OpenAPI annotations or documentation
- Non-obvious logic has comments explaining WHY
- CHANGELOG updated for user-facing changes

## Output Format

For each issue found, report:

```
[P0] Blocking call in reactive chain
File: src/main/java/com/company/service/OrderService.java:42
Problem: .block() call breaks reactive chain, causes thread starvation under load
Current:
    Order order = orderRepository.findById(id).block();
Fix:
    return orderRepository.findById(id)
        .switchIfEmpty(Mono.error(new ResourceNotFoundException("Order not found: " + id)));
```

## Summary Template

After reviewing all files, provide:

```
## Review Summary

**Files reviewed**: [count]
**Issues found**: P0: [n] | P1: [n] | P2: [n] | P3: [n]

### Decision
- [ ] APPROVE — no P0/P1 issues
- [ ] APPROVE WITH CONDITIONS — P1 issues documented
- [ ] BLOCK — P0 issues must be fixed

### Critical Issues (if any)
1. [file:line] — [one-line description]

### Positive Highlights
- [what's done well]
```

## Reference

For code patterns and correct implementations, read the `java-spring-api` skill reference files:
- `spring-boot-enterprise-errors-security.md` — exception hierarchy, security, CORS
- `spring-boot-enterprise-resilience-health.md` — Resilience4j config, health indicators, Swagger
- `spring-boot-rest-service-guide.md` — REST service patterns, external integrations
- `spring-boot-testing-unit.md` — BlockHound, resilience testing, test data builders
- `spring-boot-testing-integration.md` — Testcontainers, contract testing, WireMock, coverage
- `spring-boot-reactive-debugging.md` — Reactor Hooks, checkpoint patterns, debug mode
- `spring-boot-security-hardening.md` — OWASP scanning, static analysis, secure logging
- `spring-boot-reactive-patterns.md` — Resilience4j operators, Redis, SSE, Cloud Stream
