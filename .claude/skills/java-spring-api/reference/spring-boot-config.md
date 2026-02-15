# Spring Boot Configuration Templates

## pom.xml Essentials
```xml
<project>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.0</version>
    </parent>

    <properties>
        <java.version>21</java.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-webflux</artifactId>
            <exclusions>
                <exclusion>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-starter-logging</artifactId>
                </exclusion>
            </exclusions>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-r2dbc</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>r2dbc-postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.flywaydb</groupId>
            <artifactId>flyway-core</artifactId>
        </dependency>
        <dependency>
            <groupId>org.flywaydb</groupId>
            <artifactId>flyway-database-postgresql</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.projectreactor</groupId>
            <artifactId>reactor-test</artifactId>
            <scope>test</scope>
        </dependency>
        <!-- Log4j2 (replaces default Logback) -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-log4j2</artifactId>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
            <plugin>
                <groupId>org.jacoco</groupId>
                <artifactId>jacoco-maven-plugin</artifactId>
                <version>${jacoco-maven-plugin.version}</version>
                <executions>
                    <execution>
                        <goals><goal>prepare-agent</goal></goals>
                    </execution>
                    <execution>
                        <id>report</id>
                        <phase>prepare-package</phase>
                        <goals><goal>report</goal></goals>
                    </execution>
                    <execution>
                        <id>check</id>
                        <goals><goal>check</goal></goals>
                        <configuration>
                            <rules>
                                <rule>
                                    <element>BUNDLE</element>
                                    <limits>
                                        <limit>
                                            <counter>LINE</counter>
                                            <value>COVEREDRATIO</value>
                                            <minimum>0.90</minimum>
                                        </limit>
                                        <limit>
                                            <counter>BRANCH</counter>
                                            <value>COVEREDRATIO</value>
                                            <minimum>0.80</minimum>
                                        </limit>
                                    </limits>
                                </rule>
                            </rules>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
</project>
```

## application.yml Template
```yaml
spring:
  r2dbc:
    url: r2dbc:postgresql://localhost:5432/mydb
    username: ${DB_USERNAME:postgres}
    password: ${DB_PASSWORD:postgres}
  flyway:
    url: jdbc:postgresql://localhost:5432/mydb
    user: ${DB_USERNAME:postgres}
    password: ${DB_PASSWORD:postgres}
    enabled: ${FLYWAY_ENABLED:false}
  webflux:
    base-path: /
  lifecycle:
    timeout-per-shutdown-phase: 30s

server:
  port: 8080
  shutdown: graceful
  server-header: ""  # Suppress Server header to prevent information disclosure

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics

logging:
  config: classpath:log4j2-spring.xml
```

## Type-Safe Configuration Properties

Use Java records with `@ConfigurationProperties` for type-safe, immutable configuration. Prefer this over scattered `@Value` annotations.

```java
@ConfigurationProperties(prefix = "integration.payment-service")
public record PaymentServiceProperties(
    @NotBlank String baseUrl,
    @NotBlank String apiKey,
    @Min(100) int timeoutMs
) {}

// Enable in application class or a @Configuration class
@SpringBootApplication
@EnableConfigurationProperties(PaymentServiceProperties.class)
public class MyServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyServiceApplication.class, args);
    }
}
```

```yaml
integration:
  payment-service:
    base-url: ${PAYMENT_SERVICE_URL:http://localhost:8081}
    api-key: ${PAYMENT_SERVICE_API_KEY}
    timeout-ms: 5000
```

## log4j2-spring.xml Template

Place in `src/main/resources/log4j2-spring.xml`. Uses structured JSON for production, console pattern for local dev.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN" monitorInterval="30">
    <Properties>
        <Property name="APP_NAME">${spring:spring.application.name:-my-service}</Property>
        <Property name="LOG_PATTERN">%d{ISO8601} [%t] %-5level %logger{36} - %msg%n</Property>
    </Properties>

    <Appenders>
        <Console name="Console" target="SYSTEM_OUT">
            <PatternLayout pattern="${LOG_PATTERN}"/>
        </Console>
        <!-- JSON appender for production (structured logging) -->
        <Console name="JsonConsole" target="SYSTEM_OUT">
            <JsonTemplateLayout eventTemplateUri="classpath:EcsLayout.json"/>
        </Console>
    </Appenders>

    <Loggers>
        <Logger name="com.company" level="DEBUG" additivity="false">
            <AppenderRef ref="Console"/>
        </Logger>
        <Logger name="org.springframework" level="INFO" additivity="false">
            <AppenderRef ref="Console"/>
        </Logger>
        <Logger name="io.github.resilience4j" level="INFO" additivity="false">
            <AppenderRef ref="Console"/>
        </Logger>
        <Root level="INFO">
            <AppenderRef ref="Console"/>
        </Root>
    </Loggers>
</Configuration>
```
