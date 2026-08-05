# TypeScript REST API — HTTP Client Reference

## When to Use

Load this reference when the service **proxies or composes an upstream HTTP API** — a payment gateway, a third-party data provider, an internal microservice. Skip it if the service only talks to its own database.

---

## Packages

```json
// package.json — dependencies (add)
"opossum": "^8.1.0"

// package.json — devDependencies (add)
"@types/opossum": "^8.1.0"
```

Uses Node.js built-in `fetch` (Node 18+). No `node-fetch` needed.

---

## Error Taxonomy — `src/clients/errors.ts`

Four classes covering every upstream failure mode. Each maps to a distinct response strategy.

```typescript
import { ExtendableError } from '../errors/ExtendableError.js';
import { ReasonCode } from '../errors/codes.js';

// 5xx from upstream — upstream server is broken; our gateway failed
export class GatewayError extends ExtendableError {
  readonly reason_code = ReasonCode.BadGateway as const;

  constructor(upstream: string, cause: unknown) {
    super(`Upstream '${upstream}' is unavailable`);
    this.cause = cause;
  }
}

// Network failure — timeout, ECONNREFUSED, DNS resolution failure
export class NetworkError extends ExtendableError {
  readonly reason_code = ReasonCode.BadGateway as const;

  constructor(upstream: string, cause: unknown) {
    super(`Network failure calling upstream '${upstream}'`);
    this.cause = cause;
  }
}

// 4xx from upstream — upstream rejected our request (bad params, rate limit, etc.)
// upstreamStatus preserved so typedErrorMapper can pass it through to the caller
export class UpstreamClientError extends ExtendableError {
  readonly reason_code = ReasonCode.UpstreamRejected as const;
  readonly upstreamStatus: number;

  constructor(upstream: string, upstreamStatus: number, message: string) {
    super(`Upstream '${upstream}' rejected request (${upstreamStatus}): ${message}`);
    this.upstreamStatus = upstreamStatus;
  }
}

// Upstream returned 401/403 when WE are the authenticated client — credential misconfiguration
// Never surface as 4xx to callers — this is an internal config bug, not a caller error
export class CredentialError extends ExtendableError {
  readonly reason_code = ReasonCode.InternalError as const;

  constructor(upstream: string) {
    super(`Credential failure calling upstream '${upstream}' — check API key config`);
  }
}
```

### Extend `src/errors/codes.ts`

```typescript
export const ReasonCode = {
  // existing entries...
  // 4xxx — upstream / proxy errors
  UpstreamRejected: 4000,   // 4xx from upstream; status passed through
  // 5xxx — infrastructure / server errors (existing + new)
  InternalError:    5000,
  UpstreamFailure:  5001,
  BadGateway:       5002,   // 5xx or network failure from upstream
} as const;
```

### Extend `typedErrorMapper` in `src/middleware/typedErrorMapper.ts`

```typescript
import { GatewayError, NetworkError, UpstreamClientError, CredentialError } from '../clients/errors.js';

// Inside registerErrorMapper:
if (error instanceof GatewayError || error instanceof NetworkError) {
  return reply.status(502).send(envelope(error));
}

if (error instanceof UpstreamClientError) {
  // 4xx passthrough — preserve upstream status code; envelope shape stays consistent
  return reply.status(error.upstreamStatus).send(envelope(error));
}

if (error instanceof CredentialError) {
  // Config bug — never expose credential details; return generic 500
  return reply.status(500).send({
    success: false,
    message: 'Internal server error',
    reason_code: ReasonCode.InternalError,
  } satisfies ErrorEnvelope);
}
```

The snippet above is a diff against `registerErrorMapper` — where it goes in the existing function
isn't shown. The full merged function, combining the base domain-error branches from
`reference/service-errors.md` with the client/proxy branches above, is:

```typescript
// src/middleware/typedErrorMapper.ts — combined with domain errors from service-errors.md
import type { FastifyInstance } from 'fastify';
import { NotFoundError, DomainValidationError, ConflictError } from '../errors/domain.js';
import { GatewayError, NetworkError, UpstreamClientError, CredentialError } from '../clients/errors.js';
import { ReasonCode } from '../errors/codes.js';
import type { ErrorEnvelope, ValidationErrorEnvelope } from '../errors/types.js';

function envelope(err: { message: string; reason_code: number }): ErrorEnvelope {
  return { success: false, message: err.message, reason_code: err.reason_code };
}

export function registerErrorMapper(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request error');

    // ── Domain errors (service-errors.md) ──────────────────────────────────
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

    // ── Client/proxy errors (this file) ────────────────────────────────────
    if (error instanceof GatewayError || error instanceof NetworkError) {
      return reply.status(502).send(envelope(error));
    }

    if (error instanceof UpstreamClientError) {
      // 4xx passthrough — preserve upstream status code; envelope shape stays consistent
      return reply.status(error.upstreamStatus).send(envelope(error));
    }

    if (error instanceof CredentialError) {
      // Config bug — never expose credential details; return generic 500
      return reply.status(500).send({
        success: false,
        message: 'Internal server error',
        reason_code: ReasonCode.InternalError,
      } satisfies ErrorEnvelope);
    }

    // Fallback — 500
    return reply.status(500).send({
      success: false,
      message: 'Internal server error',
      reason_code: ReasonCode.InternalError,
    } satisfies ErrorEnvelope);
  });
}
```

> This is the canonical `registerErrorMapper` once a service has both DB-backed domain errors
> and upstream HTTP calls — it supersedes the base version in `reference/service-errors.md` for
> that case, it doesn't sit alongside it as a second copy. Domain-error branches come first
> since they're the common case; client/proxy branches after. Order between branches doesn't
> affect correctness (the classes don't overlap), but keeping domain errors first matches the
> order they were introduced in `service-errors.md`.

---

## Typed Request Helper

One file per upstream. The private `request<T>()` helper handles the fetch lifecycle, timeout, and error classification. Per-operation raw functions call it with typed return values.

```typescript
// src/clients/stripe.ts
import CircuitBreaker from 'opossum';
import { config } from '../config.js';
import { GatewayError, NetworkError, UpstreamClientError, CredentialError } from './errors.js';

export interface ChargeResult { id: string; amount: number; currency: string }
export interface RefundResult  { id: string; chargeId: string }

const BASE_URL = 'https://api.stripe.com/v1';

// ── Private fetch helper ───────────────────────────────────────────────────────

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.STRIPE_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    // Credential failure — OUR API key is wrong; never pass 401/403 to the caller
    if (res.status === 401 || res.status === 403) {
      throw new CredentialError('Stripe');
    }

    // Server-side failure
    if (res.status >= 500) {
      throw new GatewayError('Stripe', new Error(`HTTP ${res.status}`));
    }

    // Upstream rejected our request — read the error body for context
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText })) as { message?: string };
      throw new UpstreamClientError('Stripe', res.status, body.message ?? res.statusText);
    }

    try {
      return await res.json() as T;
    } catch (parseErr) {
      // 2xx with non-JSON body — upstream bug, treat as gateway failure
      throw new GatewayError('Stripe', parseErr);
    }
  } catch (err) {
    // Re-throw already-classified errors unchanged
    if (
      err instanceof CredentialError ||
      err instanceof GatewayError   ||
      err instanceof UpstreamClientError
    ) {
      throw err;
    }
    // AbortError (timeout) or network failure (ECONNREFUSED, DNS, etc.)
    throw new NetworkError('Stripe', err);
  } finally {
    clearTimeout(timer);
  }
}
```

---

## Per-Operation Raw Functions + Circuit Breaker Lazy Singletons

Each operation is a standalone `async function` so its circuit breaker is independent — a flaky `/refund` endpoint does not trip the breaker guarding `/charge`.

**Lazy singletons are required.** Modules execute before `loadApp()` runs, which is before `z.parse(process.env)` validates config. Constructing a `CircuitBreaker` at module scope reads `config.STRIPE_TIMEOUT_MS` before it is safe to do so.

```typescript
// ── Per-operation raw functions ────────────────────────────────────────────────

async function chargeRaw(amount: number, currency: string): Promise<ChargeResult> {
  return request<ChargeResult>('/charges', {
    method: 'POST',
    body: JSON.stringify({ amount, currency }),
  });
}

async function refundRaw(chargeId: string): Promise<RefundResult> {
  return request<RefundResult>(`/charges/${chargeId}/refunds`, { method: 'POST' });
}

// ── Circuit breaker lazy singletons ───────────────────────────────────────────

function makeBreakerOptions<F extends (...args: never[]) => Promise<unknown>>(
  fn: F,
): ConstructorParameters<typeof CircuitBreaker<F>>[1] {
  return {
    timeout: config.STRIPE_TIMEOUT_MS,
    errorThresholdPercentage: 50,
    resetTimeout: 30_000,
    // errorFilter: return true = don't count this error as a circuit failure.
    // 4xx errors are expected client errors — rate limits and bad params should
    // not trip the breaker. Only 5xx and network failures should open the circuit.
    errorFilter: (err: Error) => err instanceof UpstreamClientError,
  };
}

let _chargeBreaker: CircuitBreaker<typeof chargeRaw> | null = null;
let _refundBreaker: CircuitBreaker<typeof refundRaw> | null = null;

function getChargeBreaker(): CircuitBreaker<typeof chargeRaw> {
  _chargeBreaker ??= new CircuitBreaker(chargeRaw, makeBreakerOptions(chargeRaw));
  return _chargeBreaker;
}

function getRefundBreaker(): CircuitBreaker<typeof refundRaw> {
  _refundBreaker ??= new CircuitBreaker(refundRaw, makeBreakerOptions(refundRaw));
  return _refundBreaker;
}

// ── Public client interface ────────────────────────────────────────────────────

export interface StripeClient {
  charge(amount: number, currency: string): Promise<ChargeResult>;
  refund(chargeId: string): Promise<RefundResult>;
}

export function createStripeClient(): StripeClient {
  return {
    charge: (amount, currency) => getChargeBreaker().fire(amount, currency),
    refund: (chargeId)         => getRefundBreaker().fire(chargeId),
  };
}
```

---

## classifyUpstreamError — `src/clients/errors.ts`

Call in a service-level `catch` after invoking a client method. Always throws — never returns. The single rule: **never wrap an unknown error in `GatewayError`** — that masks bugs as infrastructure failures.

> Named `classifyUpstreamError`, not `handleXError` — `reference/service-errors.md` already
> exports a function called `handleXError` with the opposite 4xx behavior (it always wraps into
> a 500 `UpstreamError`; this one classifies into 4 distinct classes with 4xx passthrough). Same
> name, incompatible behavior, both plausible imports for "the upstream call failed, do
> something" — the rename makes it impossible to grab the wrong one by accident.

```typescript
// Add to src/clients/errors.ts, after the error class definitions

export function classifyUpstreamError(err: unknown, upstream: string): never {
  // Already classified — pass through unchanged
  if (
    err instanceof GatewayError       ||
    err instanceof NetworkError        ||
    err instanceof UpstreamClientError ||
    err instanceof CredentialError
  ) {
    throw err;
  }

  // Circuit breaker open — opossum rejects with code 'EOPENBREAKER'
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'EOPENBREAKER') {
    throw new GatewayError(upstream, err);
  }

  // Unknown error — rethrow the original unchanged.
  // This preserves the real stack trace and lets typedErrorMapper return a 500.
  // Wrapping in GatewayError here would convert a bug in your code into a 502,
  // hiding the root cause behind "upstream unavailable".
  throw err as Error;
}
```

Usage in a service:

```typescript
// src/services/payment.service.ts
async charge(amount: number, currency: string): Promise<ChargeResult> {
  try {
    return await this.stripe.charge(amount, currency);
  } catch (err) {
    this.log.error({ err, amount, currency }, 'Stripe charge failed');
    classifyUpstreamError(err, 'Stripe');
  }
}
```

**Status mapping via `typedErrorMapper`:**

| Error thrown | HTTP status | Notes |
|---|---|---|
| `GatewayError` | 502 | Upstream 5xx |
| `NetworkError` | 502 | Timeout, ECONNREFUSED |
| `UpstreamClientError` | `error.upstreamStatus` | 4xx passthrough |
| `CredentialError` | 500 | Config bug — no details surfaced |
| Unknown (rethrown) | 500 | typedErrorMapper fallback |

---

## Config Additions

```typescript
// src/config.ts — add to the Zod env schema
STRIPE_SECRET_KEY:  z.string().min(1),
STRIPE_TIMEOUT_MS:  z.coerce.number().int().positive().default(5_000),
```

```dotenv
# .env.example
STRIPE_SECRET_KEY=sk_test_...
STRIPE_TIMEOUT_MS=5000
```

---

## Forbidden Patterns

```typescript
// ❌ Module-level circuit breaker — reads config before z.parse(process.env) runs
const chargeBreaker = new CircuitBreaker(chargeRaw, { timeout: config.STRIPE_TIMEOUT_MS });

// ❌ Module-level fetch config — same import-time config hazard
const baseUrl = config.STRIPE_BASE_URL;

// ❌ No errorFilter — 429 rate limits and 400 bad params trip the breaker
const breaker = new CircuitBreaker(fn, { timeout: 5_000 });

// ❌ One breaker for all operations — a slow endpoint trips the circuit for healthy ones
const breaker = new CircuitBreaker(request, { ... });

// ❌ Catch-all GatewayError wrap — masks your own bugs as upstream failures
} catch (err) {
  throw new GatewayError('Stripe', err);  // err might be a TypeError in your code, not Stripe's
}

// ❌ Swallowed catch
} catch { return null; }

// ❌ Credential errors surfaced to callers
if (res.status === 401) throw new UpstreamClientError('Stripe', 401, '...');
// Use CredentialError — callers should never see 401 from YOUR service because of YOUR bad key
```
