# TypeScript REST API — Observability Reference (DogStatsD / hot-shots)

## When to Use

Load this reference when the service emits **custom application metrics** to Datadog via DogStatsD. Skip it for structured logging only — Pino handles that. Metrics and logs are complementary: metrics for dashboards and alerting, logs for debugging.

---

## Packages

```json
// package.json — dependencies (add)
"hot-shots": "^10.0.0"
```

---

## Metrics Singleton — `src/metrics.ts`

```typescript
import StatsD from 'hot-shots';
import { config } from './config.js';
import { logger } from './logger.js';

let _metrics: StatsD | null = null;

// Throttle DogStatsD connection errors — a dead agent would otherwise flood the logs at
// however often hot-shots retries. Module-level so the throttle state persists across calls.
let _lastErrorAt = 0;
function onMetricsError(err: Error): void {
  const now = Date.now();
  if (now - _lastErrorAt >= 60_000) {
    _lastErrorAt = now;
    // logger (src/logger.ts), not request.log — this callback fires from hot-shots' own
    // internals, never from inside a request, so there is no request.log in scope. Same
    // reasoning as db.ts's pool.on('error', ...) handler in reference/service-database.md.
    logger.error({ err }, 'DogStatsD error (throttled to 1/min)');
  }
}

export function initMetrics(): void {
  if (_metrics !== null) return; // double-init guard
  _metrics = new StatsD({
    host: config.STATSD_HOST,
    port: config.STATSD_PORT,
    prefix: `${config.SERVICE_NAME}.`,
    globalTags: { env: config.NODE_ENV, service: config.SERVICE_NAME },
    errorHandler: onMetricsError,
  });
}

export function closeMetrics(): void {
  _metrics?.close();
  _metrics = null;
}

export function getMetrics(): StatsD {
  if (_metrics === null) {
    throw new Error('Metrics not initialized — call initMetrics() before getMetrics()');
  }
  return _metrics;
}
```

Wire into `server.ts` following the same lifecycle pattern as `initDb()`:

```typescript
// src/server.ts
const server = await loadApp();
await initDb();
initMetrics();                             // sync — no await needed
await server.listen({ port: config.PORT, host: '0.0.0.0' });

// Shutdown — close in reverse init order
server.server.closeIdleConnections();
await server.close();
closeMetrics();                            // sync
await closeDb();
process.exit(0);
```

---

## Bounded Cardinality — The Only Rule That Matters

High-cardinality tags create unbounded metric series in Datadog, blowing up ingestion costs and making dashboards unusable. Every tag value must come from a fixed, enumerable set.

**Allowed:**

| Tag | Example values | Why safe |
|-----|---------------|----------|
| `operation` | `'create_work_item'`, `'list_work_items'` | Fixed enum of operation names |
| `outcome` | `'success'`, `'failure'` | Binary |
| `status` | `'200'`, `'4xx'`, `'5xx'` | HTTP status bucket |
| `error_class` | `'NotFoundError'`, `'GatewayError'` | Fixed set of class names |
| `env` | `'production'`, `'staging'` | Global tag, set once |

**Never in tags:**

| Tag | Problem |
|-----|---------|
| `{ workItemId }`, `{ userId }`, `{ orderId }` | One series per entity — unbounded |
| `{ path: request.url }` | Query strings make URLs unbounded |
| `{ email }`, `{ title }` | Free text; also PII risk |
| `{ message: err.message }` | Error messages are free text — unbounded |

```typescript
// ❌ Unbounded — one metric series per work item
getMetrics().increment('work_item.created', { workItemId: item.id });

// ✅ Bounded — fixed cardinality
getMetrics().increment('work_item.created', { operation: 'create' });
```

---

## Timing Pattern — Every Path, Including Failures

Emit timing on both success and failure paths. A metric that fires only on success makes it impossible to detect when an operation is silently failing or how long failures take.

```typescript
// src/services/work-item.service.ts
async create(title: string): Promise<WorkItem> {
  const start = Date.now();
  const tags = { operation: 'create_work_item' };

  try {
    if (!title.trim()) throw new DomainValidationError('Title must not be blank.');

    const item = createWorkItem(title);
    await this.repository.save(getDb(), item);
    this.log.info({ workItemId: item.id }, 'Work item created');

    getMetrics().timing('service.operation.duration', Date.now() - start, {
      ...tags, outcome: 'success',
    });
    return item;
  } catch (err) {
    getMetrics().timing('service.operation.duration', Date.now() - start, {
      ...tags,
      outcome: 'failure',
      // error_class is the class name — bounded (fixed set of error classes), not the message
      error_class: err instanceof Error ? err.constructor.name : 'UnknownError',
    });
    throw err;
  }
}
```

> The timing wraps the full `try/catch`. Both paths emit a metric before the error propagates. The `error_class` tag uses the constructor name — bounded — never `err.message` — unbounded.

---

## Config Additions

Added to the canonical env schema in `reference/service-config.md` (each needs a `fieldMeta`
entry too — none of these are sensitive):

```typescript
STATSD_HOST:  z.string().default('localhost'),
STATSD_PORT:  z.coerce.number().int().positive().default(8125),
SERVICE_NAME: z.string().min(1).default('myapi'),
```

```dotenv
# .env.example
STATSD_HOST=localhost
STATSD_PORT=8125
SERVICE_NAME=myapi
```

---

## Forbidden Patterns

```typescript
// ❌ Module-level StatsD — hot-shots reads the agent address at construction time, so this
// runs before z.parse(process.env) validates config. Symptom is a silent wrong value, or a
// crash if config is referenced before its module runs. Same constraint as initDb(): no
// resource construction at module scope that reads `config`.
const metrics = new StatsD({ host: config.STATSD_HOST, port: config.STATSD_PORT });

// ❌ No errorHandler — UDP errors throw uncaught exceptions
const metrics = new StatsD({ host: 'localhost', port: 8125 });

// ❌ Unthrottled errorHandler — dead agent → millions of lines/minute to stderr
new StatsD({ errorHandler: (err) => console.error(err) });

// ❌ Timing only on the success path — failures produce no metric
try {
  const result = await operation();
  getMetrics().timing('duration', Date.now() - start);  // no catch branch
  return result;
}

// ❌ Unbounded tags — see the cardinality tables above
getMetrics().increment('request', { userId, workItemId, path: req.url });
getMetrics().increment('error', { message: err.message });
getMetrics().increment('work_item.created', { title: item.title });  // also PII risk
```
