# TypeScript REST API — HTTP Client Reference

## When to Use

Load this reference when the service **proxies or composes an upstream HTTP API** — a payment
gateway, a third-party data provider, an internal microservice. Skip it if the service only
talks to its own database.

Uses Node's built-in `fetch` (no `node-fetch`). One added package:

```json
// package.json — dependencies / devDependencies
"opossum": "^8.1.0"
"@types/opossum": "^8.1.0"
```

---

## Error Taxonomy — `src/clients/errors.ts`

Four classes covering every way a fetch to an upstream can fail — 5xx, network/timeout, 4xx,
and our-own-bad-credential. That exhaustiveness is what lets one mapper translate every failure
into the right HTTP status by class alone, with no per-route special-casing.

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

// Upstream returned 401/403 when WE are the authenticated client — credential
// misconfiguration. Never surfaced as 4xx: this is our config bug, not a caller error.
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
  // 5xxx — infrastructure / server errors
  InternalError:    5000,
  UpstreamFailure:  5001,
  BadGateway:       5002,   // 5xx or network failure from upstream
} as const;
```

### Extend `registerErrorMapper`

Insert these branches into the existing function in `src/middleware/typedErrorMapper.ts`
(`reference/service-errors.md`) — **after** the `ConflictError` branch, **before** the 500
fallback. Everything else in that function is unchanged; there is no second copy of it.

```typescript
import { GatewayError, NetworkError, UpstreamClientError, CredentialError } from '../clients/errors.js';

    if (error instanceof GatewayError || error instanceof NetworkError) {
      return reply.status(502).send(envelope(error));
    }

    if (error instanceof UpstreamClientError) {
      // 4xx passthrough — preserve upstream status; envelope shape stays consistent
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

Ordering between branches doesn't affect correctness (the classes don't overlap). Every
dependency-failure body uses the standard `{ success, message, reason_code }` envelope —
`CredentialError` builds it literally only to substitute a generic message, not to introduce a
different contract. No upstream-specific field (a provider error code, a nested `{ upstream }`
object) is ever added.

---

## Route Handlers Never Branch on Upstream Errors

The handler calls the service; the service calls `classifyUpstreamError()` in its `catch` and
rethrows. The handler does not catch, does not inspect the error type, and does not construct a
response — `throw` in a Fastify handler hands the error to the single registered
`setErrorHandler`, which is the **only** place `instanceof` on an upstream error may appear.

```typescript
// ✅ No knowledge of Stripe, GatewayError, or any upstream-specific type
app.post('/charges', { schema: { body: ChargeRequestSchema } }, async (request) => {
  return paymentService.charge(request.body.amount, request.body.currency);
});

// ❌ Forbidden — duplicates the mapper inside the handler
app.post('/charges', ..., async (request, reply) => {
  try {
    return await paymentService.charge(request.body.amount, request.body.currency);
  } catch (err) {
    if (err instanceof GatewayError) return reply.status(502).send(...);
  }
});
```

---

## Typed Request Helper

One file per upstream. The private `request<T>()` helper owns the fetch lifecycle, timeout, and
error classification; per-operation raw functions call it with typed return values.

```typescript
// src/clients/stripe.ts
import CircuitBreaker from 'opossum';
import { config } from '../config.js';
import { GatewayError, NetworkError, UpstreamClientError, CredentialError } from './errors.js';

export interface ChargeResult { id: string; amount: number; currency: string }
export interface RefundResult  { id: string; chargeId: string }

const BASE_URL = 'https://api.stripe.com/v1';

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
      // 2xx with a non-JSON body — upstream bug, treat as gateway failure
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

## Per-Operation Functions + Circuit Breaker Lazy Singletons

Each operation is a standalone function so its breaker is independent — a flaky `/refund` must
not trip the breaker guarding `/charge`.

**Lazy singletons are required.** Modules execute before `loadApp()` runs, which is before
`z.parse(process.env)` validates config. Constructing a `CircuitBreaker` at module scope reads
`config.STRIPE_TIMEOUT_MS` before it is safe to do so.

```typescript
async function chargeRaw(amount: number, currency: string): Promise<ChargeResult> {
  return request<ChargeResult>('/charges', {
    method: 'POST',
    body: JSON.stringify({ amount, currency }),
  });
}

async function refundRaw(chargeId: string): Promise<RefundResult> {
  return request<RefundResult>(`/charges/${chargeId}/refunds`, { method: 'POST' });
}

function makeBreakerOptions<F extends (...args: never[]) => Promise<unknown>>(
  fn: F,
): ConstructorParameters<typeof CircuitBreaker<F>>[1] {
  return {
    timeout: config.STRIPE_TIMEOUT_MS,
    errorThresholdPercentage: 50,
    resetTimeout: 30_000,
    // errorFilter: true = don't count this error as a circuit failure. 4xx are expected
    // client errors — rate limits and bad params must not open the circuit.
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

Call it in a service-level `catch` after invoking a client method. Always throws, never returns.

> Named `classifyUpstreamError`, not `handleXError`: `reference/service-errors.md` documents a
> `handleXError` shape with the opposite 4xx behavior (always wraps into a 500 `UpstreamError`;
> this one classifies into four classes with 4xx passthrough). Same-sounding name, incompatible
> behavior, both plausible imports — the distinct name makes grabbing the wrong one impossible.

```typescript
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

  // Unknown error — rethrow the original unchanged: same type, message, and stack.
  // Wrapping it in GatewayError would convert "our code has a bug" into "the upstream is
  // down", destroying the one signal pointing at the real cause. typedErrorMapper's
  // fallback turns it into a 500.
  throw err as Error;
}
```

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

**Resulting status mapping:**

| Error thrown | HTTP status | Notes |
|---|---|---|
| `GatewayError` | 502 | Upstream 5xx, or breaker open |
| `NetworkError` | 502 | Timeout, ECONNREFUSED |
| `UpstreamClientError` | `error.upstreamStatus` | 4xx passthrough |
| `CredentialError` | 500 | Config bug — no details surfaced |
| Unknown (rethrown) | 500 | typedErrorMapper fallback |

---

## Config Additions

Added to the canonical env schema in `reference/service-config.md` (each needs a `fieldMeta`
entry too — `STRIPE_SECRET_KEY` is `sensitive: true`):

```typescript
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
// ❌ Module-level circuit breaker or fetch config — reads config before z.parse(process.env)
const chargeBreaker = new CircuitBreaker(chargeRaw, { timeout: config.STRIPE_TIMEOUT_MS });
const baseUrl = config.STRIPE_BASE_URL;

// ❌ No errorFilter — 429 rate limits and 400 bad params trip the breaker
const breaker = new CircuitBreaker(fn, { timeout: 5_000 });

// ❌ One breaker for all operations — a slow endpoint trips the circuit for healthy ones
const breaker = new CircuitBreaker(request, { ... });

// ❌ Catch-all GatewayError wrap — masks your own bugs as upstream failures
} catch (err) {
  throw new GatewayError('Stripe', err);  // err might be a TypeError in YOUR code
}

// ❌ Swallowed catch
} catch { return null; }

// ❌ Credential errors surfaced to callers — they should never see a 401 caused by YOUR key
if (res.status === 401) throw new UpstreamClientError('Stripe', 401, '...');
```
