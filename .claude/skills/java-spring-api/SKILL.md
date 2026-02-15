---
name: java-spring-api
description: This skill provides patterns and templates for Java 21 Spring Boot 3.5.x WebFlux REST API development. It should be activated when creating controllers, services, repositories, DTOs, or reactive tests.
allowed-tools: Bash, Read, Write, Edit
---

# Java 21 + Spring Boot 3.5.x WebFlux REST API Skill

## Conventions & Rules

> For code conventions, package layout, and reactive rules, read `reference/spring-boot-conventions.md`

## Quick Scaffold — New Spring Boot Project

```bash
# Using Spring Initializr via curl
curl https://start.spring.io/starter.zip \
  -d type=maven-project \
  -d language=java \
  -d javaVersion=21 \
  -d bootVersion=3.5.0 \
  -d dependencies=webflux,r2dbc,postgresql,flyway,validation,actuator,lombok \
  -d groupId=com.company \
  -d artifactId=my-service \
  -d name=my-service \
  -o my-service.zip && unzip my-service.zip -d my-service
```

## Process

1. **Scaffold** using Spring Initializr or the command above
2. **Configure** pom.xml and application.yml — read `reference/spring-boot-config.md`
3. **Create files** using templates — read `reference/spring-boot-templates.md` for DTO, Entity, Repository, Service, Controller, and Test templates
4. **Follow conventions** below for package layout and reactive rules
5. **Write tests** with `@SpringBootTest` + `WebTestClient`
6. **Format and check**: `mvn spotless:apply` or IDE formatter

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| **DTOs** | Java records with `jakarta.validation` annotations |
| **Entities** | Classes with `@Table`, `@Id` R2DBC annotations |
| **Repositories** | Extend `ReactiveCrudRepository<T, UUID>` |
| **Services** | `@Service` + `@RequiredArgsConstructor`, return `Mono`/`Flux` |
| **Controllers** | `@RestController` + `@RequestMapping("/api/v1/...")` |
| **Error handling** | `@ControllerAdvice` returning `ProblemDetail` (RFC 9457) |
| **Config** | `application.yml` with `${ENV_VAR:default}` placeholders |
| **Migrations** | Flyway in `src/main/resources/db/migration/` (disabled by default; enable with `FLYWAY_ENABLED=true`) |

## Reference Files

| File | Content |
|------|---------|
| `reference/spring-boot-config.md` | pom.xml template, application.yml configuration |
| `reference/spring-boot-templates.md` | DTO, Entity, Repository, Service, Controller, Test, Error Handler templates |
| `reference/spring-boot-enterprise-errors-security.md` | Exception hierarchy, Security (OAuth2/JWT), CORS |
| `reference/spring-boot-enterprise-resilience-health.md` | Resilience4j, WebClient pool, Health indicators, Swagger |
| `reference/spring-boot-rest-service-guide.md` | OpenAPI+DDL driven workflow, MapStruct mapping, External service clients, WireMock testing |
| `reference/spring-boot-testing-unit.md` | BlockHound, Resilience4j testing, test data builders |
| `reference/spring-boot-testing-integration.md` | Testcontainers, contract testing, WireMock, coverage |
| `reference/spring-boot-reactive-debugging.md` | Reactor Hooks (onOperatorError, onNextDropped, onErrorDropped), checkpoint patterns, debug mode control |
| `reference/spring-boot-security-hardening.md` | OWASP dependency scanning, static analysis patterns, HSTS, JWT role extraction, secure logging |
| `reference/spring-boot-reactive-patterns.md` | Resilience4j operators, Redis reactive, SSE, Spring Cloud Stream, custom operators, threading anti-patterns |
| `reference/spring-reactive-review-checklist.md` | Spring reactive review checklist (used by `spring-reactive-reviewer` agent) |

## Documentation Sources

Before generating code, consult these sources for current syntax and APIs:

| Source | URL / Tool | Purpose |
|--------|-----------|---------|
| Spring Boot | `Context7` MCP | Latest Spring Boot APIs, annotations, configuration |
| Spring Initializr | `https://start.spring.io` | Project scaffolding with correct dependencies |

## Common Commands

```bash
mvn spring-boot:run                  # Run backend
mvn test                             # Run tests
mvn package                          # Build JAR
mvn spotless:apply                   # Format code
mvn clean test -Dspring.profiles.active=test  # Run tests with test profile
mvn dependency:tree                  # Show dependency tree
```

## Error Handling

**Validation errors**: Use `jakarta.validation` annotations on DTO records. Handle via `@ControllerAdvice` returning `ProblemDetail` with `HttpStatus.BAD_REQUEST` (400).

**Not-found errors**: Use `switchIfEmpty(Mono.error(new ResourceNotFoundException(...)))` in services.

**Duplicate errors**: Catch `DataIntegrityViolationException` in services and convert to `409 Conflict`.
