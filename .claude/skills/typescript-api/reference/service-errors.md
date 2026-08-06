# TypeScript REST API — Error Handling Reference

## Model

Every error response — 4xx and 500 — uses one envelope:

```json
{ "success": false, "message": "...", "reason_code": 1001 }
```

The one sanctioned extension is `validation_errors: ZodIssue[]` on validation failures. No other
field is ever added.

**The named anti-pattern:** ad-hoc `reply.status(4xx).send({ type, title, status, ... })` in
route handlers. See Forbidden Patterns.

---

## Directory Layout

```
src/
├── errors/
│   ├── ExtendableError.ts      # abstract base class
│   ├── codes.ts                # reason_code registry
│   ├── types.ts                # ErrorEnvelope + ValidationErrorEnvelope
│   ├── domain.ts               # NotFoundError, DomainValidationError, ConflictError
│   └── helpers.ts              # sendValidationError()
└── middleware/
    └── typedErrorMapper.ts     # Fastify setErrorHandler — class → status
```

---

## Envelope and Base Class

```typescript
// src/errors/types.ts
import type { ZodIssue } from 'zod';

export interface ErrorEnvelope {
  readonly success: false;
  readonly message: string;
  readonly reason_code: number;
}

// The one sanctioned extension — only for validation failures
export interface ValidationErrorEnvelope extends ErrorEnvelope {
  readonly validation_errors: readonly ZodIssue[];
}
```

```typescript
// src/errors/ExtendableError.ts
export abstract class ExtendableError extends Error {
  abstract readonly reason_code: number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore the prototype chain broken by TypeScript when targeting ES5.
    // Required for instanceof to work correctly across module boundaries.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

---

```typescript
// src/errors/codes.ts — the one registry; never inline a numeric literal at a throw site
export const ReasonCode = {
  // 1xxx — domain errors
  NotFound:         1001,
  ValidationFailed: 1002,
  Conflict:         1003,
  // 5xxx — infrastructure / server errors
  InternalError:    5000,
  UpstreamFailure:  5001,
} as const;
```

---

## Domain Error Classes — `src/errors/domain.ts`

```typescript
import type { ZodIssue } from 'zod';
import { ExtendableError } from './ExtendableError.js';
import { ReasonCode } from './codes.js';

export class NotFoundError extends ExtendableError {
  readonly reason_code = ReasonCode.NotFound as const;   // type: 1001

  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' was not found`);
  }
}

export class DomainValidationError extends ExtendableError {
  readonly reason_code = ReasonCode.ValidationFailed as const;  // type: 1002
  readonly validation_errors?: readonly ZodIssue[];

  constructor(message: string, issues?: readonly ZodIssue[]) {
    super(message);
    this.validation_errors = issues;
  }
}

export class ConflictError extends ExtendableError {
  readonly reason_code = ReasonCode.Conflict as const;   // type: 1003

  constructor(message: string) {
    super(message);
  }
}
```

> `reason_code = ReasonCode.X as const` gives each property a **literal type** (`1001`), not
> `number` — that's what lets TypeScript narrow `reason_code` in type guards.

---

## typedErrorMapper — `src/middleware/typedErrorMapper.ts`

Registered once in `loadApp()` after `setNotFoundHandler` (see `reference/service-app.md` for
the surrounding wiring). This is the **only** place that maps error class to HTTP status — no
route handler contains `instanceof` or status logic.

```typescript
import type { FastifyInstance } from 'fastify';
import { NotFoundError, DomainValidationError, ConflictError } from '../errors/domain.js';
import { ReasonCode } from '../errors/codes.js';
import type { ErrorEnvelope, ValidationErrorEnvelope } from '../errors/types.js';

function envelope(err: { message: string; reason_code: number }): ErrorEnvelope {
  return { success: false, message: err.message, reason_code: err.reason_code };
}

export function registerErrorMapper(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request error');

    if (error instanceof NotFoundError) {
      return reply.status(404).send(envelope(error));
    }

    if (error instanceof DomainValidationError) {
      const body: ValidationErrorEnvelope | ErrorEnvelope = error.validation_errors
        ? { ...envelope(error), validation_errors: [...error.validation_errors] }
        : envelope(error);
      return reply.status(400).send(body);
    }

    if (error instanceof ConflictError) {
      return reply.status(409).send(envelope(error));
    }

    // Fallback — 500. Not a formality: this is what guarantees a genuine bug (a TypeError
    // from your own code, an unguarded null) still surfaces as a plain 500 instead of being
    // absorbed or misreported. Anything not explicitly classified above drops through here.
    return reply.status(500).send({
      success: false,
      message: 'Internal server error',
      reason_code: ReasonCode.InternalError,
    } satisfies ErrorEnvelope);
  });
}
```

> A service proxying an upstream HTTP API adds four more branches to this function — see
> `reference/service-clients.md`.

---

## Route Handler Pattern

Handlers **throw** custom error classes. They never construct error responses.

```typescript
// ✅ Correct — throw; typedErrorMapper owns status + envelope
app.get('/workitems/:id', { schema: { params: WorkItemIdParamSchema } }, async (request) => {
  const item = await service.getById(workItemIdFrom(request.params.id));
  // service throws NotFoundError if not found — propagates to typedErrorMapper
  return item;
});
```

`throw err` is the Fastify equivalent of Express's `next(err)` — Fastify routes the thrown error
to `setErrorHandler` automatically.

---

## Two Accepted Validation Shapes

Both apply only when automatic Fastify/Zod validation isn't enough — cross-field rules, partial
updates, a shape that doesn't map cleanly onto `{ schema: { body: ... } }`. Pick one per handler;
**either way, raw Zod never appears in the handler body.**

### Shape A — parse-and-throw: `src/validation/<feature>-request.ts`

Takes `unknown`, returns a typed DTO, throws `DomainValidationError` on failure. The handler
never branches — same throw-based shape as every other failure path in this skill.

```typescript
// src/validation/update-work-item-request.ts
import { z } from 'zod';
import { DomainValidationError } from '../errors/domain.js';

const UpdateWorkItemRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export interface UpdateWorkItemRequest {
  title?: string;
}

export function parseUpdateWorkItemRequest(input: unknown): UpdateWorkItemRequest {
  const parsed = UpdateWorkItemRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainValidationError('Invalid update work item request', parsed.error.issues);
  }
  return parsed.data;
}
```

```typescript
app.patch('/workitems/:id', ..., async (request) => {
  const dto = parseUpdateWorkItemRequest(request.body); // throws DomainValidationError → 400
  return service.update(workItemIdFrom(request.params.id), dto);
});
```

> `PATCH`/`service.update()` are illustrative — the canonical `IWorkItemService`
> (`reference/service-domain.md`) has only `listAll`/`getById`/`create`/`delete`.

### Shape B — safeParse + sendValidationError

`sendValidationError` (`src/errors/helpers.ts`) is the one sanctioned way to reply inline for a
validation failure. The schema lives in the feature's `validation-schema/` file (see
`reference/service-implementation.md`), never inline in the handler.

```typescript
// src/errors/helpers.ts
import type { FastifyReply } from 'fastify';
import type { ZodIssue } from 'zod';
import { ReasonCode } from './codes.js';
import type { ValidationErrorEnvelope } from './types.js';

export function sendValidationError(
  reply: FastifyReply,
  issues: ZodIssue[],
): ReturnType<FastifyReply['send']> {
  return reply.status(400).send({
    success: false,
    message: 'Validation failed',
    reason_code: ReasonCode.ValidationFailed,
    validation_errors: issues,
  } satisfies ValidationErrorEnvelope);
}
```

```typescript
// UpdateWorkItemSchema imported from validation-schema/work-items.schema.js
const parsed = UpdateWorkItemSchema.safeParse(request.body);
if (!parsed.success) return sendValidationError(reply, parsed.error.issues);
```

**Choosing:** default to Shape A — it keeps every handler on the same "throw, never branch on
failure" shape as the rest of the skill. Reach for Shape B only when the handler genuinely needs
the `safeParse` result object itself (e.g. reading `parsed.data` differently depending on which
optional fields were present), not merely to validate-then-proceed.

---

## handleXError — Upstream Failure Pattern

For each external dependency, create a normaliser that throws an `ExtendableError` subclass.
Name it `handleXError` where X is the upstream (e.g. `handleStripeError`).

```typescript
// src/errors/domain.ts — alongside the other error classes
export class UpstreamError extends ExtendableError {
  readonly reason_code = ReasonCode.UpstreamFailure as const;

  constructor(upstream: string, cause: unknown) {
    super(`${upstream} request failed`);
    this.cause = cause;
  }
}

// src/services/payment.service.ts
async charge(amount: number): Promise<void> {
  try {
    await stripeClient.charge({ amount });
  } catch (err) {
    this.log.error({ err }, 'Stripe charge failed');
    throw new UpstreamError('Stripe', err); // always throws — typedErrorMapper returns 500
  }
}
```

The route handler needs no knowledge of Stripe-specific error shapes — it lets the error
propagate to `typedErrorMapper`.

> This is the lightweight shape: every upstream failure becomes one 500. A service that needs
> 4xx passthrough, 502s, and circuit breaking uses `classifyUpstreamError()` instead — a
> deliberately different name for deliberately different behavior. See
> `reference/service-clients.md`; don't mix the two for the same upstream.

---

## Forbidden Patterns

```typescript
// ❌ Ad-hoc inline 4xx — the named anti-pattern
return reply.status(404).send({
  type: 'https://tools.ietf.org/html/rfc7807',
  title: 'Work item not found',
  status: 404,
  instance: request.url,
});

// ❌ RFC 7807 ProblemDetails shape (type/title/status/instance), in a response body or as a
// ProblemDetailsSchema in a route's response schema — superseded by ErrorEnvelope

// ❌ statusFor() switch in route files — maps error.kind to status code per route
function statusFor(error: AppError): number {
  switch (error.kind) { case 'NotFound': return 404; ... }
}

// ❌ instanceof check in a route handler — belongs in typedErrorMapper only
if (result.error instanceof NotFoundError) {
  return reply.status(404).send(...);
}

// ❌ Naked envelope construction — bypasses the helper contract
return reply.status(400).send({ success: false, message: '...', reason_code: 1002 });
// Use sendValidationError() or throw DomainValidationError instead.
```
