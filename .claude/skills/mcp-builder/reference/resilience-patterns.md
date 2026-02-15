# Enterprise Resilience Stack for MCP Servers

This document provides production-ready resilience patterns for MCP servers that integrate with external APIs.

## Resilience Flow Diagram

```
User Request → Rate Limiter → Bulkhead → Circuit Breaker → Retry Strategy → Connection Pool → External API
     ↓              ↓             ↓              ↓                ↓                 ↓              ↓
  Validate    Reject if     Queue if      Skip if          Exponential        Reuse TCP      Response
   Input      rate limit    saturated     open            backoff + jitter   connections
```

## Circuit Breaker Implementation

### Types and Configuration

```typescript
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;        // Number of failures before opening
  successThreshold: number;         // Successes needed to close from half-open
  timeout: number;                  // Ms to wait before half-open (60000)
  monitoringPeriod: number;         // Ms window for failure tracking (120000)
}

interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime?: number;
  lastStateChange: number;
}
```

### Full Circuit Breaker Class

```typescript
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureTimestamps: number[] = [];
  private consecutiveSuccesses = 0;
  private consecutiveFailures = 0;
  private lastStateChange = Date.now();

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastStateChange >= this.config.timeout) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    if (this.state === 'HALF_OPEN') {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
      }
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.failureTimestamps.push(now);
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    // Remove failures outside monitoring window
    this.failureTimestamps = this.failureTimestamps.filter(
      (timestamp) => now - timestamp < this.config.monitoringPeriod
    );

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
    } else if (
      this.state === 'CLOSED' &&
      this.failureTimestamps.length >= this.config.failureThreshold
    ) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === 'CLOSED') {
      this.failureTimestamps = [];
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures = 0;
    }
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failureTimestamps.length,
      successes: this.consecutiveSuccesses,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.failureTimestamps[this.failureTimestamps.length - 1],
      lastStateChange: this.lastStateChange,
    };
  }

  reset(): void {
    this.transitionTo('CLOSED');
  }
}
```

## Bulkhead Pattern

### Semaphore-Based Concurrency Control

```typescript
interface BulkheadConfig {
  maxConcurrent: number;     // Max concurrent executions
  maxQueue: number;          // Max queued requests
  queueTimeout: number;      // Ms before queued request times out
}

export class Bulkhead {
  private activeCount = 0;
  private queue: Array<{
    resolve: (value: void) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];

  constructor(private config: BulkheadConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeCount < this.config.maxConcurrent) {
      this.activeCount++;
      return;
    }

    if (this.queue.length >= this.config.maxQueue) {
      throw new Error('Bulkhead queue is full');
    }

    return new Promise<void>((resolve, reject) => {
      const timestamp = Date.now();
      this.queue.push({ resolve, reject, timestamp });

      // Timeout handler
      setTimeout(() => {
        const index = this.queue.findIndex((item) => item.timestamp === timestamp);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Bulkhead queue timeout'));
        }
      }, this.config.queueTimeout);
    });
  }

  private release(): void {
    this.activeCount--;

    const next = this.queue.shift();
    if (next) {
      this.activeCount++;
      next.resolve();
    }
  }

  getMetrics() {
    return {
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      availableSlots: this.config.maxConcurrent - this.activeCount,
    };
  }
}
```

## Rate Limiter

### Token Bucket Algorithm

```typescript
interface RateLimiterConfig {
  maxRequests: number;    // Max requests per window
  windowMs: number;       // Time window in ms
  burstSize: number;      // Max burst capacity
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private config: RateLimiterConfig) {
    this.tokens = config.burstSize;
    this.lastRefill = Date.now();
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.refillTokens();

    if (this.tokens < 1) {
      throw new Error('Rate limit exceeded');
    }

    this.tokens--;
    return fn();
  }

  private refillTokens(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const refillRate = this.config.maxRequests / this.config.windowMs;
    const tokensToAdd = timePassed * refillRate;

    this.tokens = Math.min(this.config.burstSize, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getMetrics() {
    this.refillTokens();
    return {
      availableTokens: Math.floor(this.tokens),
      maxTokens: this.config.burstSize,
      refillRate: this.config.maxRequests / (this.config.windowMs / 1000),
    };
  }

  reset(): void {
    this.tokens = this.config.burstSize;
    this.lastRefill = Date.now();
  }
}
```

## Retry Strategy

### Exponential Backoff with Jitter

```typescript
interface RetryConfig {
  maxAttempts: number;         // Max retry attempts
  initialDelay: number;        // Initial delay in ms
  maxDelay: number;            // Max delay in ms
  backoffMultiplier: number;   // Multiplier for exponential backoff
  jitterFactor: number;        // Random jitter (0-1)
  retryableErrors: string[];   // Regex patterns for retryable errors
}

export class RetryStrategy {
  constructor(private config: RetryConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isRetryable(lastError)) {
          throw lastError;
        }

        if (attempt < this.config.maxAttempts - 1) {
          const delay = this.calculateDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Retry failed');
  }

  private isRetryable(error: Error): boolean {
    return this.config.retryableErrors.some((pattern) => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(error.message) || regex.test(error.name);
    });
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attempt),
      this.config.maxDelay
    );

    const jitter = exponentialDelay * this.config.jitterFactor * Math.random();
    return Math.floor(exponentialDelay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

## Connection Pool

### Undici Pool Manager Configuration

```typescript
import { Pool } from 'undici';

interface PoolConfig {
  connections: number;           // Max connections per origin
  pipelining: number;            // Max pipelined requests
  connectTimeout: number;        // Connection timeout in ms
  bodyTimeout: number;           // Body timeout in ms
  headersTimeout: number;        // Headers timeout in ms
  keepAliveTimeout: number;      // Keep-alive timeout in ms
  keepAliveMaxTimeout: number;   // Max keep-alive timeout in ms
}

export function createConnectionPool(url: string, config: PoolConfig): Pool {
  return new Pool(url, {
    connections: config.connections,
    pipelining: config.pipelining,
    connectTimeout: config.connectTimeout,
    bodyTimeout: config.bodyTimeout,
    headersTimeout: config.headersTimeout,
    keepAliveTimeout: config.keepAliveTimeout,
    keepAliveMaxTimeout: config.keepAliveMaxTimeout,
  });
}
```

## Production Configuration

### Complete Resilience Stack

```typescript
export const PRODUCTION_RESILIENCE_CONFIG = {
  // Connection Pool
  pool: {
    connections: 10,
    pipelining: 1,
    connectTimeout: 10_000,
    bodyTimeout: 30_000,
    headersTimeout: 10_000,
    keepAliveTimeout: 4_000,
    keepAliveMaxTimeout: 600_000,
  },

  // Circuit Breaker
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60_000,              // 1 minute before half-open
    monitoringPeriod: 120_000,    // 2 minute rolling window
  },

  // Bulkhead
  bulkhead: {
    maxConcurrent: 10,
    maxQueue: 20,
    queueTimeout: 5_000,
  },

  // Rate Limiter
  rateLimiter: {
    maxRequests: 50,
    windowMs: 60_000,             // 50 requests per minute
    burstSize: 60,
  },

  // Retry Strategy
  retry: {
    maxAttempts: 3,
    initialDelay: 100,
    maxDelay: 5_000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
    retryableErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'socket hang up',
      '429',
      '500',
      '502',
      '503',
      '504',
    ],
  },
} as const;
```

### Composing Resilience Patterns

```typescript
import { Pool } from 'undici';

export class ResilientHttpClient {
  private pool: Pool;
  private circuitBreaker: CircuitBreaker;
  private bulkhead: Bulkhead;
  private rateLimiter: RateLimiter;
  private retry: RetryStrategy;

  constructor(baseUrl: string, config = PRODUCTION_RESILIENCE_CONFIG) {
    this.pool = createConnectionPool(baseUrl, config.pool);
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    this.bulkhead = new Bulkhead(config.bulkhead);
    this.rateLimiter = new RateLimiter(config.rateLimiter);
    this.retry = new RetryStrategy(config.retry);
  }

  async request<T>(path: string, options?: any): Promise<T> {
    return this.rateLimiter.execute(() =>
      this.bulkhead.execute(() =>
        this.circuitBreaker.execute(() =>
          this.retry.execute(async () => {
            const response = await this.pool.request({
              path,
              method: options?.method || 'GET',
              headers: options?.headers,
              body: options?.body,
            });

            if (response.statusCode >= 400) {
              throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
            }

            return response.body.json() as Promise<T>;
          })
        )
      )
    );
  }

  getMetrics() {
    return {
      circuitBreaker: this.circuitBreaker.getMetrics(),
      bulkhead: this.bulkhead.getMetrics(),
      rateLimiter: this.rateLimiter.getMetrics(),
    };
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}
```

### Usage Example

```typescript
const client = new ResilientHttpClient('https://api.example.com');

try {
  const data = await client.request<UserData>('/users/123');
  console.log('User data:', data);
} catch (error) {
  console.error('Request failed after all resilience attempts:', error);
}

// Monitor health
const metrics = client.getMetrics();
console.log('Circuit breaker state:', metrics.circuitBreaker.state);
console.log('Active requests:', metrics.bulkhead.activeCount);
console.log('Available rate limit tokens:', metrics.rateLimiter.availableTokens);
```
