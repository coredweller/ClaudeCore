# Spring Boot Enterprise Patterns — Resilience, Health & Monitoring

Production-ready resilience, health check, and infrastructure patterns for Java 21 + Spring Boot 3.5.x WebFlux.

## Resilience4j Configuration

### application.yml

```yaml
resilience4j:
  circuitbreaker:
    configs:
      default:
        sliding-window-type: COUNT_BASED
        sliding-window-size: 100
        minimum-number-of-calls: 20
        failure-rate-threshold: 50
        slow-call-rate-threshold: 100
        slow-call-duration-threshold: 5s
        wait-duration-in-open-state: 30s
        permitted-number-of-calls-in-half-open-state: 10
        automatic-transition-from-open-to-half-open-enabled: true
        register-health-indicator: true
  retry:
    configs:
      default:
        max-attempts: 3
        wait-duration: 500ms
        enable-exponential-backoff: true
        exponential-backoff-multiplier: 2
        exponential-max-wait-duration: 5s
        retry-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
          - org.springframework.web.reactive.function.client.WebClientRequestException
        ignore-exceptions:
          - com.company.service.exception.InvalidInputException
          - com.company.service.exception.BusinessRuleException
  ratelimiter:
    configs:
      default:
        limit-for-period: 100
        limit-refresh-period: 1s
        timeout-duration: 1s
  timelimiter:
    configs:
      default:
        timeout-duration: 3s
        cancel-running-future: true
  bulkhead:
    configs:
      default:
        max-concurrent-calls: 25
        max-wait-duration: 0ms
```

### Maven Dependency

```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
</dependency>
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-reactor</artifactId>
</dependency>
```

## WebClient Connection Pool

```java
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient.Builder webClientBuilder(
            @Value("${webclient.pool.max-connections:100}") int maxConnections,
            @Value("${webclient.pool.acquire-timeout-millis:5000}") int acquireTimeout,
            @Value("${webclient.pool.response-timeout-millis:10000}") int responseTimeout) {

        ConnectionProvider provider = ConnectionProvider.builder("app-pool")
            .maxConnections(maxConnections)
            .pendingAcquireTimeout(Duration.ofMillis(acquireTimeout))
            .build();

        HttpClient httpClient = HttpClient.create(provider)
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
            .responseTimeout(Duration.ofMillis(responseTimeout))
            .doOnConnected(conn -> conn
                .addHandlerLast(new ReadTimeoutHandler(responseTimeout, TimeUnit.MILLISECONDS))
                .addHandlerLast(new WriteTimeoutHandler(responseTimeout, TimeUnit.MILLISECONDS)));

        return WebClient.builder()
            .clientConnector(new ReactorClientHttpConnector(httpClient));
    }
}
```

### application.yml

```yaml
webclient:
  pool:
    max-connections: 100
    acquire-timeout-millis: 5000
    response-timeout-millis: 10000
```

## Reactive Health Indicators

```java
@Component("applicationHealth")
@ConditionalOnProperty(name = "health.application.enabled", havingValue = "true", matchIfMissing = true)
public class ApplicationHealthIndicator implements ReactiveHealthIndicator {

    @Override
    public Mono<Health> health() {
        return Mono.just(Health.up()
                .withDetail("name", "application")
                .withDetail("timestamp", Instant.now().toString())
                .build())
            .onErrorResume(ex -> Mono.just(Health.down(ex)
                .withDetail("error", ex.getMessage())
                .build()));
    }
}
```

### Actuator Configuration

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, info, prometheus, metrics, loggers
      base-path: /management
    enabled-by-default: false
  endpoint:
    health:
      enabled: true
      show-details: always
      probes:
        enabled: true
      group:
        liveness:
          include: ping
        readiness:
          include: "*"
    info:
      enabled: true
    prometheus:
      enabled: true
    metrics:
      enabled: true
    loggers:
      enabled: true
  metrics:
    tags:
      application: ${spring.application.name}
    distribution:
      percentiles-histogram:
        http.server.requests: true
```

## R2DBC Connection Pool

```yaml
spring:
  r2dbc:
    pool:
      enabled: true
      initial-size: 5
      max-size: 20
      max-idle-time: 30m
      max-life-time: 1h
      max-acquire-time: 2s
      max-create-connection-time: 5s
      validation-query: SELECT 1
```

## Swagger / OpenAPI Configuration

```java
@Configuration
public class SwaggerConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
            .addSecurityItem(new SecurityRequirement().addList("BearerAuth"))
            .components(new Components()
                .addSecuritySchemes("BearerAuth", new SecurityScheme()
                    .name("BearerAuth")
                    .type(SecurityScheme.Type.HTTP)
                    .scheme("bearer")
                    .bearerFormat("JWT")));
    }
}
```

### Maven Dependency

```xml
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webflux-ui</artifactId>
    <version>2.8.6</version>
</dependency>
```

### application.yml

```yaml
springdoc:
  api-docs:
    path: /v3/api-docs
  swagger-ui:
    path: /swagger-ui.html
    display-request-duration: true
    operations-sorter: alpha
```
