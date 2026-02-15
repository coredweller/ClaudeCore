# OpenTelemetry Observability Stack for Production MCP Servers

This document provides production-ready OpenTelemetry instrumentation patterns for MCP servers, including tracing, metrics, and adaptive sampling strategies.

## Dependencies

```json
{
  "@opentelemetry/sdk-node": "~0.57.0",
  "@opentelemetry/auto-instrumentations-node": "~0.54.0",
  "@opentelemetry/exporter-trace-otlp-http": "~0.57.0",
  "@opentelemetry/exporter-metrics-otlp-http": "~0.57.0",
  "@opentelemetry/resources": "~1.29.0",
  "@opentelemetry/semantic-conventions": "~1.29.0",
  "@opentelemetry/api": "~1.9.0"
}
```

## Tracing Setup

Full initialization function with NodeSDK, auto-instrumentation, and OTLP exporters:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

interface ObservabilityConfig {
  serviceName: string;
  serviceVersion: string;
  environment: 'development' | 'staging' | 'production';
  otlpEndpoint?: string;
  enableAutoInstrumentation?: boolean;
}

export function initializeObservability(config: ObservabilityConfig): NodeSDK {
  const {
    serviceName,
    serviceVersion,
    environment,
    otlpEndpoint = 'http://localhost:4318',
    enableAutoInstrumentation = true
  } = config;

  // Create resource with service metadata
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: environment
  });

  // Configure OTLP trace exporter
  const traceExporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
    headers: {}
  });

  // Configure OTLP metrics exporter with 10s export interval
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
      headers: {}
    }),
    exportIntervalMillis: 10000 // 10 seconds
  });

  // Initialize NodeSDK
  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: enableAutoInstrumentation
      ? [getNodeAutoInstrumentations()]
      : []
  });

  // Start the SDK
  sdk.start();

  // Graceful shutdown on process termination
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('OpenTelemetry SDK shut down successfully'))
      .catch((error) => console.error('Error shutting down OpenTelemetry SDK', error))
      .finally(() => process.exit(0));
  });

  return sdk;
}

// Usage example
// const sdk = initializeObservability({
//   serviceName: 'my-mcp-server',
//   serviceVersion: '1.0.0',
//   environment: 'production',
//   otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
// });
```

## Custom MCP Spans

Wrapper function to create custom spans for MCP tool executions:

```typescript
import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('mcp-server');

interface SpanAttributes {
  [key: string]: string | number | boolean;
}

export async function withTracing<T>(
  spanName: string,
  attributes: SpanAttributes,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    spanName,
    { kind: SpanKind.SERVER, attributes },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error'
        });

        // Record exception with stack trace
        span.recordException(error as Error);

        throw error;
      } finally {
        span.end();
      }
    }
  );
}

// Usage example for MCP tool
// async function executeTool(toolName: string, params: unknown) {
//   return withTracing(
//     `mcp.tool.${toolName}`,
//     {
//       'tool.name': toolName,
//       'tool.params': JSON.stringify(params),
//       'mcp.version': '1.0'
//     },
//     async () => {
//       // Tool execution logic
//       return performToolOperation(params);
//     }
//   );
// }
```

## MCP Metrics Collection

Custom metrics using OpenTelemetry Metrics API:

```typescript
import { metrics } from '@opentelemetry/api';
import { Counter, Histogram, UpDownCounter, ObservableGauge } from '@opentelemetry/api';

const meter = metrics.getMeter('mcp-server-metrics');

// Counter: Total tool invocations
const toolInvocationsCounter = meter.createCounter('mcp_tool_invocations_total', {
  description: 'Total number of MCP tool invocations',
  unit: '1'
});

// Histogram: Tool execution duration
const toolDurationHistogram = meter.createHistogram('mcp_tool_duration_seconds', {
  description: 'MCP tool execution duration in seconds',
  unit: 's'
});

// Counter: Total tool errors
const toolErrorsCounter = meter.createCounter('mcp_tool_errors_total', {
  description: 'Total number of MCP tool errors',
  unit: '1'
});

// Counter: Resource reads
const resourceReadsCounter = meter.createCounter('mcp_resource_reads_total', {
  description: 'Total number of MCP resource read operations',
  unit: '1'
});

// UpDownCounter: Active connections
const activeConnectionsCounter = meter.createUpDownCounter('mcp_active_connections', {
  description: 'Number of active MCP client connections',
  unit: '1'
});

// ObservableGauge: Circuit breaker state
let circuitBreakerStates: Map<string, number> = new Map();

const circuitBreakerGauge = meter.createObservableGauge('mcp_circuit_breaker_state', {
  description: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  unit: '1'
});

circuitBreakerGauge.addCallback((observableResult) => {
  for (const [service, state] of circuitBreakerStates.entries()) {
    observableResult.observe(state, { service });
  }
});

export function updateCircuitBreakerState(service: string, state: 'closed' | 'open' | 'half-open') {
  const stateValue = state === 'closed' ? 0 : state === 'open' ? 1 : 2;
  circuitBreakerStates.set(service, stateValue);
}

// Helper function to instrument tool execution
export async function instrumentToolExecution<T>(
  toolName: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await fn();

    // Record successful invocation
    toolInvocationsCounter.add(1, {
      tool_name: toolName,
      success: 'true'
    });

    // Record duration
    const durationSeconds = (Date.now() - startTime) / 1000;
    toolDurationHistogram.record(durationSeconds, {
      tool_name: toolName
    });

    return result;
  } catch (error) {
    // Record failed invocation
    toolInvocationsCounter.add(1, {
      tool_name: toolName,
      success: 'false'
    });

    // Record error
    toolErrorsCounter.add(1, {
      tool_name: toolName,
      error_type: error instanceof Error ? error.constructor.name : 'UnknownError'
    });

    throw error;
  }
}

// Helper functions for other metrics
export function recordResourceRead(resourceType: string) {
  resourceReadsCounter.add(1, { resource_type: resourceType });
}

export function incrementActiveConnections() {
  activeConnectionsCounter.add(1);
}

export function decrementActiveConnections() {
  activeConnectionsCounter.add(-1);
}

// Usage example
// async function executeSearchTool(query: string) {
//   return instrumentToolExecution('search_products', async () => {
//     return searchDatabase(query);
//   });
// }
```

## Sampling Strategies

Per-tool cost control with adaptive sampling:

```typescript
import { Sampler, SamplingDecision, SamplingResult } from '@opentelemetry/sdk-trace-base';
import { Context, SpanKind, Attributes } from '@opentelemetry/api';

interface SamplingConfig {
  toolSampling: Record<string, number>; // Per-tool sampling rates (0.0-1.0)
  defaultSampling: {
    read: number;
    write: number;
    admin: number;
  };
  adaptiveSampling: {
    enabled: boolean;
    errorThreshold: number; // Error rate threshold to trigger high sampling
    highSamplingRate: number; // Sampling rate when errors are high
    cooldownMinutes: number; // Cooldown period after high sampling
  };
}

// Production sampling configuration
export const productionSamplingConfig: SamplingConfig = {
  toolSampling: {
    'process_payment': 1.0,        // Always trace payment operations
    'get_user_profile': 0.01,      // 1% sampling for read-heavy operations
    'search_products': 0.05,       // 5% sampling for searches
    'update_inventory': 0.1,       // 10% for writes
    'escalate_to_human': 1.0,      // Always trace escalations
    'generate_report': 0.02,       // 2% for expensive operations
    'send_notification': 0.001     // 0.1% for high-volume operations
  },
  defaultSampling: {
    read: 0.01,   // 1% for read operations
    write: 0.1,   // 10% for write operations
    admin: 1.0    // 100% for admin operations
  },
  adaptiveSampling: {
    enabled: true,
    errorThreshold: 0.05,      // Increase sampling if error rate > 5%
    highSamplingRate: 0.5,     // Sample 50% during high errors
    cooldownMinutes: 15        // Cool down for 15 minutes
  }
};

class MCPToolSampler implements Sampler {
  private config: SamplingConfig;
  private errorRateWindow: Array<{ timestamp: number; isError: boolean }> = [];
  private highSamplingUntil: number = 0;

  constructor(config: SamplingConfig) {
    this.config = config;
  }

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes
  ): SamplingResult {
    // Extract tool name from span name or attributes
    const toolName = (attributes['tool.name'] as string) ||
                     spanName.replace('mcp.tool.', '');

    // Check if we're in adaptive high sampling mode
    if (this.config.adaptiveSampling.enabled) {
      const now = Date.now();

      // Check if still in high sampling cooldown
      if (now < this.highSamplingUntil) {
        if (Math.random() < this.config.adaptiveSampling.highSamplingRate) {
          return { decision: SamplingDecision.RECORD_AND_SAMPLED };
        }
      }

      // Calculate current error rate
      const errorRate = this.calculateErrorRate();
      if (errorRate > this.config.adaptiveSampling.errorThreshold) {
        this.highSamplingUntil = now + (this.config.adaptiveSampling.cooldownMinutes * 60 * 1000);
        return { decision: SamplingDecision.RECORD_AND_SAMPLED };
      }
    }

    // Per-tool sampling rate
    let samplingRate: number;

    if (toolName in this.config.toolSampling) {
      samplingRate = this.config.toolSampling[toolName];
    } else {
      // Determine operation type from attributes
      const operationType = (attributes['operation.type'] as string) || 'read';
      samplingRate = this.config.defaultSampling[operationType as keyof typeof this.config.defaultSampling]
                     || this.config.defaultSampling.read;
    }

    // Make sampling decision
    const shouldSample = Math.random() < samplingRate;

    return {
      decision: shouldSample
        ? SamplingDecision.RECORD_AND_SAMPLED
        : SamplingDecision.NOT_RECORD
    };
  }

  toString(): string {
    return 'MCPToolSampler';
  }

  private calculateErrorRate(): number {
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);

    // Clean old entries
    this.errorRateWindow = this.errorRateWindow.filter(
      entry => entry.timestamp > fiveMinutesAgo
    );

    if (this.errorRateWindow.length === 0) return 0;

    const errorCount = this.errorRateWindow.filter(e => e.isError).length;
    return errorCount / this.errorRateWindow.length;
  }

  recordExecution(isError: boolean) {
    this.errorRateWindow.push({
      timestamp: Date.now(),
      isError
    });
  }
}

// Usage in NodeSDK initialization
// import { MCPToolSampler, productionSamplingConfig } from './observability';
//
// const sdk = new NodeSDK({
//   resource,
//   traceExporter,
//   sampler: new MCPToolSampler(productionSamplingConfig),
//   // ... other config
// });
```

## Integration Example

Complete example showing initialization and usage:

```typescript
import { initializeObservability } from './observability/tracing.js';
import {
  instrumentToolExecution,
  recordResourceRead,
  incrementActiveConnections,
  decrementActiveConnections
} from './observability/metrics.js';
import { withTracing } from './observability/tracing.js';

// Initialize on server startup
const sdk = initializeObservability({
  serviceName: 'payment-mcp-server',
  serviceVersion: '2.1.0',
  environment: 'production',
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'
});

// Instrument MCP tool handler
async function handleToolCall(toolName: string, params: unknown) {
  return instrumentToolExecution(toolName, async () => {
    return withTracing(
      `mcp.tool.${toolName}`,
      {
        'tool.name': toolName,
        'tool.params_size': JSON.stringify(params).length,
        'mcp.protocol_version': '1.0'
      },
      async () => {
        switch (toolName) {
          case 'process_payment':
            return processPayment(params);
          case 'get_user_profile':
            recordResourceRead('user_profile');
            return getUserProfile(params);
          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }
      }
    );
  });
}

// Track connections
function onClientConnected() {
  incrementActiveConnections();
}

function onClientDisconnected() {
  decrementActiveConnections();
}
```

## Best Practices

1. **Always sample critical operations** - Payment processing, authentication, escalations should have 1.0 sampling rate
2. **Use adaptive sampling** - Automatically increase sampling during incidents when error rates spike
3. **Monitor high-cardinality attributes** - Avoid adding user IDs or request IDs directly to metric labels
4. **Set export intervals appropriately** - 10s for metrics, immediate for traces in production
5. **Use semantic conventions** - Follow OpenTelemetry semantic conventions for attribute naming
6. **Implement graceful shutdown** - Always shut down SDK on SIGTERM to flush remaining data
7. **Record exceptions properly** - Use `span.recordException()` to capture stack traces
8. **Test sampling rates in staging** - Verify your sampling configuration doesn't miss critical traces before deploying to production
