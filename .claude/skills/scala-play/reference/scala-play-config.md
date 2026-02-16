# Scala 3 + Play Framework — Config Reference

## build.sbt

```scala
ThisBuild / scalaVersion := "3.3.4"
ThisBuild / organization := "com.company"
ThisBuild / version      := "0.1.0-SNAPSHOT"

lazy val root = (project in file("."))
  .enablePlugins(PlayScala)
  .settings(
    name := "my-play-app",

    // ── Dependencies ───────────────────────────────────────────
    libraryDependencies ++= Seq(
      // No guice — compile-time DI only (see AppLoader)
      "org.typelevel"  %% "cats-core"                       % "2.12.0",
      "org.typelevel"  %% "cats-effect"                     % "3.5.4",
      "co.fs2"         %% "fs2-core"                        % "3.11.0",
      "io.github.iltotore" %% "iron"                        % "2.6.0",
      "io.github.iltotore" %% "iron-cats"                   % "2.6.0",
      // Testing
      "org.scalatestplus.play" %% "scalatestplus-play"       % "7.0.1"  % Test,
      "org.typelevel"  %% "cats-effect-testing-scalatest"    % "1.5.0"  % Test,
    ),

    // ── Compiler options ───────────────────────────────────────
    // NOTE: Play's sbt plugin already adds -deprecation, -feature, -unchecked.
    // Do NOT repeat them here — under -Xfatal-warnings, duplicates are fatal errors.
    scalacOptions ++= Seq(
      "-Xfatal-warnings",
      "-Wunused:imports",
      "-Wunused:privates",
      "-Wunused:locals",
      // -Wunused:params intentionally omitted — context parameters like
      // ExecutionContext are provided by default in controllers and will
      // be flagged as unused before real work is added.
    ),

    // Play's routes compiler generates code with unused imports.
    // Suppress warnings from generated sources to avoid false positives.
    scalacOptions += "-Wconf:src=routes/.*:s",

    // ── Disable Guice (compile-time DI only) ──────────────────
    // Remove the guice dep above and exclude Play's default app loader
    PlayKeys.playDefaultPort := 9000,
  )
```

> **Compile-time DI:** Remove the `guice` dependency entirely. Play discovers
> your `AppLoader` via `application.conf` (`play.application.loader`).

---

## project/plugins.sbt

```scala
addSbtPlugin("org.playframework" % "sbt-plugin"        % "3.0.5")  // Play 3.x uses org.playframework, not com.typesafe.play
addSbtPlugin("org.scalameta"     % "sbt-scalafmt"      % "2.5.2")
addSbtPlugin("com.github.sbt"    % "sbt-native-packager" % "1.10.4")
// Optional: hot reload
addSbtPlugin("io.spray"          % "sbt-revolver"      % "0.10.0")
```

## project/build.properties

```
sbt.version=1.10.7
```

---

## application.conf

```hocon
# Application secret — MUST be overridden in production via APP_SECRET env var
play.http.secret.key = "changeme"
play.http.secret.key = ${?APP_SECRET}

# Compile-time DI loader
play.application.loader = "loader.AppLoader"

# Allowed hosts (restrict in production)
play.filters.hosts {
  allowed = ["localhost", "127.0.0.1", ${?APP_HOST}]
}

# CSRF — enabled by default; configure token name if needed
# play.filters.csrf.token.name = "csrfToken"

# CORS
play.filters.cors {
  allowedOrigins = ["http://localhost:4200"]
  allowedHttpMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  allowedHttpHeaders = ["Accept", "Content-Type", "Authorization"]
}

# HTTP filters applied in order
play.filters.enabled += "play.filters.hosts.AllowedHostsFilter"
play.filters.enabled += "play.filters.cors.CORSFilter"
play.filters.enabled += "play.filters.csrf.CSRFFilter"
play.filters.enabled += "play.filters.headers.SecurityHeadersFilter"

# Thread pool for blocking I/O (if needed)
contexts {
  database {
    executor = "thread-pool-executor"
    throughput = 1
    thread-pool-executor {
      fixed-pool-size = 32
    }
  }
}
```

---

## logback.xml

```xml
<configuration>
  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
  </appender>

  <logger name="play" level="INFO"/>
  <logger name="application" level="DEBUG"/>

  <root level="WARN">
    <appender-ref ref="STDOUT"/>
  </root>
</configuration>
```

> Add `"net.logstash.logback" % "logstash-logback-encoder" % "8.0"` to
> `libraryDependencies` for structured JSON output. For simple console output
> use the default `PatternLayoutEncoder` instead.

---

## Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

# sbt stage produces a self-contained directory — copy it in
COPY target/universal/stage /app

EXPOSE 9000

ENV APP_SECRET=""
ENV APP_HOST="0.0.0.0"

ENTRYPOINT ["/app/bin/my-play-app", \
  "-Dplay.http.secret.key=${APP_SECRET}", \
  "-Dplay.server.http.address=0.0.0.0"]
```

## docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "9000:9000"
    environment:
      APP_SECRET: "local-dev-secret-change-me"
      APP_HOST: "localhost"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:9000/api/v1/health"]
      interval: 10s
      retries: 3
```

> Build image: `sbt stage && docker-compose build`
> Run: `docker-compose up`
