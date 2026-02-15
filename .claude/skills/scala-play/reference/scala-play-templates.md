# Scala 3 + Play Framework — Code Templates

## Directory Layout

```
app/
├── loader/
│   └── AppLoader.scala          # Compile-time DI entry point
├── controllers/
│   ├── TaskController.scala
│   └── HealthController.scala
├── services/
│   └── TaskService.scala
├── repositories/
│   ├── TaskRepository.scala     # Trait
│   └── InMemoryTaskRepository.scala
└── domain/
    ├── Task.scala               # Model + opaque type + JSON format
    └── TaskError.scala          # Scala 3 enum
conf/
├── application.conf
├── logback.xml
└── routes
test/
└── services/
    └── TaskServiceSpec.scala
```

---

## Domain Model — `domain/Task.scala`

```scala
package domain

import java.time.Instant
import java.util.UUID
import play.api.libs.json.*

// ── Opaque type for domain identity ───────────────────────────
opaque type TaskId = UUID

object TaskId:
  def apply(uuid: UUID): TaskId      = uuid
  def generate(): TaskId             = UUID.randomUUID()
  def fromString(s: String): Either[String, TaskId] =
    try Right(UUID.fromString(s))
    catch case _: IllegalArgumentException => Left(s"Invalid TaskId: $s")

  // Scala 3 given — NOT implicit def
  given Format[TaskId] = Format(
    Reads(_.validate[String].flatMap { s =>
      fromString(s).fold(
        err => JsError(err),
        id  => JsSuccess(id)
      )
    }),
    Writes(id => JsString(id.toString))
  )

// ── Aggregate ─────────────────────────────────────────────────
case class Task(
  id:        TaskId,
  title:     String,
  createdAt: Instant
)

object Task:
  given OFormat[Task] = Json.format[Task]
```

## Domain Error — `domain/TaskError.scala`

```scala
package domain

// Scala 3 enum — no sealed trait needed for simple ADTs
enum TaskError:
  case NotFound(id: TaskId)
  case ValidationError(message: String)
```

---

## Repository — `repositories/TaskRepository.scala`

```scala
package repositories

import cats.effect.IO
import domain.{Task, TaskId}

trait TaskRepository:
  def findAll(): IO[List[Task]]
  def findById(id: TaskId): IO[Option[Task]]
  def save(task: Task): IO[Task]
  def delete(id: TaskId): IO[Boolean]
```

## In-Memory Repository — `repositories/InMemoryTaskRepository.scala`

```scala
package repositories

import cats.effect.{IO, Ref}
import domain.{Task, TaskId}

final class InMemoryTaskRepository(store: Ref[IO, Map[TaskId, Task]])
    extends TaskRepository:

  def findAll(): IO[List[Task]] =
    store.get.map(_.values.toList)

  def findById(id: TaskId): IO[Option[Task]] =
    store.get.map(_.get(id))

  def save(task: Task): IO[Task] =
    store.update(_ + (task.id -> task)).as(task)

  def delete(id: TaskId): IO[Boolean] =
    store.modify { m =>
      if m.contains(id) then (m - id, true)
      else (m, false)
    }

object InMemoryTaskRepository:
  // Smart constructor returns IO — caller wires it via AppComponents
  def make(): IO[InMemoryTaskRepository] =
    Ref.of[IO, Map[TaskId, Task]](Map.empty)
      .map(new InMemoryTaskRepository(_))
```

---

## Service — `services/TaskService.scala`

```scala
package services

import cats.effect.IO
import domain.*
import repositories.TaskRepository
import java.time.Instant

final class TaskService(repo: TaskRepository):

  def listAll(): IO[List[Task]] =
    repo.findAll()

  def findById(id: TaskId): IO[Either[TaskError, Task]] =
    repo.findById(id).map {
      case Some(task) => Right(task)
      case None       => Left(TaskError.NotFound(id))
    }

  def create(title: String): IO[Either[TaskError, Task]] =
    if title.isBlank then
      IO.pure(Left(TaskError.ValidationError("title must not be blank")))
    else
      val task = Task(TaskId.generate(), title.trim, Instant.now())
      repo.save(task).map(Right(_))
```

> **Never use `Future` here.** All IO stays as `IO` until the controller boundary.

---

## Controller — `controllers/TaskController.scala`

```scala
package controllers

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import domain.{Task, TaskId, TaskError}
import play.api.libs.json.*
import play.api.mvc.*
import services.TaskService

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

// NOTE: constructor injection here works for both Guice AND compile-time DI.
// With compile-time DI you instantiate this manually in AppComponents.
final class TaskController(
  service: TaskService,
  cc:      ControllerComponents
)(using runtime: IORuntime, ec: ExecutionContext)
    extends AbstractController(cc):

  // ── Helper: IO[Either[TaskError, A]] → Future[Result] ─────
  private def toResult[A](io: IO[Either[TaskError, A]])(f: A => Result): Future[Result] =
    io.map {
      case Right(value)                   => f(value)
      case Left(TaskError.NotFound(id))   => NotFound(Json.obj("error" -> s"Task $id not found"))
      case Left(TaskError.ValidationError(msg)) => BadRequest(Json.obj("error" -> msg))
    }.unsafeToFuture()

  def list: Action[AnyContent] = Action.async {
    service.listAll()
      .map(tasks => Ok(Json.toJson(tasks)))
      .unsafeToFuture()
  }

  def findById(id: String): Action[AnyContent] = Action.async {
    TaskId.fromString(id) match
      case Left(err)  => Future.successful(BadRequest(Json.obj("error" -> err)))
      case Right(tid) => toResult(service.findById(tid))(task => Ok(Json.toJson(task)))
  }

  def create: Action[JsValue] = Action.async(parse.json) { request =>
    request.body.validate[CreateTaskRequest] match
      case JsError(errors) =>
        Future.successful(BadRequest(Json.obj("error" -> JsError.toJson(errors))))
      case JsSuccess(req, _) =>
        toResult(service.create(req.title))(task => Created(Json.toJson(task)))
  }

// ── Request DTO ───────────────────────────────────────────────
case class CreateTaskRequest(title: String)
object CreateTaskRequest:
  given Reads[CreateTaskRequest] = Json.reads[CreateTaskRequest]
```

## Health Controller — `controllers/HealthController.scala`

```scala
package controllers

import play.api.libs.json.Json
import play.api.mvc.*
import java.time.Instant

final class HealthController(cc: ControllerComponents)
    extends AbstractController(cc):

  def check: Action[AnyContent] = Action {
    Ok(Json.obj(
      "status"    -> "ok",
      "timestamp" -> Instant.now().toString
    ))
  }
```

---

## Compile-Time DI — `loader/AppLoader.scala`

```scala
package loader

import cats.effect.unsafe.IORuntime
import controllers.{HealthController, TaskController}
import play.api.ApplicationLoader.Context
import play.api.BuiltInComponentsFromContext
import play.api.mvc.EssentialFilter
import play.api.routing.Router
import play.filters.HttpFiltersComponents
import repositories.InMemoryTaskRepository
import router.Routes
import services.TaskService

import scala.concurrent.ExecutionContext

class AppLoader extends play.api.ApplicationLoader:
  def load(context: Context): play.api.Application =
    new AppComponents(context).application

class AppComponents(context: Context)
    extends BuiltInComponentsFromContext(context)
    with HttpFiltersComponents:

  // Cats Effect runtime — one per JVM, lives for app lifetime
  given IORuntime = IORuntime.global
  given ExecutionContext = executionContext

  // ── Wiring ────────────────────────────────────────────────
  private val repo: InMemoryTaskRepository =
    InMemoryTaskRepository.make().unsafeRunSync()   // safe at startup only

  private val taskService    = TaskService(repo)
  private val taskController = TaskController(taskService, controllerComponents)
  private val healthController = HealthController(controllerComponents)

  // Play's generated router from conf/routes
  override def router: Router =
    new Routes(httpErrorHandler, taskController, healthController)

  override def httpFilters: Seq[EssentialFilter] = super.httpFilters
```

> `unsafeRunSync()` is acceptable **once at startup** to initialise the in-memory store.
> For production use Doobie/Slick with `Resource[IO, _]` and allocate via `allocated`.

---

## conf/routes

```
GET    /api/v1/health       controllers.HealthController.check
GET    /api/v1/tasks        controllers.TaskController.list
POST   /api/v1/tasks        controllers.TaskController.create
GET    /api/v1/tasks/:id    controllers.TaskController.findById(id: String)
```

---

## Test — `test/services/TaskServiceSpec.scala`

```scala
package services

import cats.effect.IO
import cats.effect.testing.scalatest.AsyncIOSpec
import domain.{Task, TaskError, TaskId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AsyncWordSpec
import repositories.InMemoryTaskRepository

class TaskServiceSpec extends AsyncWordSpec with AsyncIOSpec with Matchers:

  private def makeService: IO[TaskService] =
    InMemoryTaskRepository.make().map(TaskService(_))

  "TaskService.listAll" should {
    "return empty list initially" in {
      makeService.flatMap(_.listAll()).asserting(_ shouldBe empty)
    }
  }

  "TaskService.create" should {
    "create a task with a generated ID" in {
      makeService.flatMap { svc =>
        svc.create("Buy milk").asserting {
          case Right(task) =>
            task.title shouldBe "Buy milk"
          case Left(err) =>
            fail(s"Expected Right but got Left($err)")
        }
      }
    }

    "reject blank titles" in {
      makeService.flatMap(_.create("  ")).asserting {
        _ shouldBe Left(TaskError.ValidationError("title must not be blank"))
      }
    }
  }

  "TaskService.findById" should {
    "return NotFound for unknown ID" in {
      val unknownId = TaskId.generate()
      makeService.flatMap(_.findById(unknownId)).asserting {
        _ shouldBe Left(TaskError.NotFound(unknownId))
      }
    }

    "return the task after creation" in {
      makeService.flatMap { svc =>
        for
          created <- svc.create("Walk the dog")
          id       = created.toOption.get.id
          found   <- svc.findById(id)
        yield found shouldBe Right(created.toOption.get)
      }
    }
  }
```

> `AsyncIOSpec` from `cats-effect-testing-scalatest` eliminates `.unsafeRunSync()`
> in tests. Every test method returns `IO[Assertion]` — the framework runs it.
