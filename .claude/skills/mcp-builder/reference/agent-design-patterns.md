# MCP Design Patterns for Autonomous Agents — Core

This reference covers the 5 foundational design patterns that EVERY MCP server should implement. For advanced patterns (idempotency, context carryover, circuit breakers, audit trails) and domain-specific presets, read `agent-design-patterns-advanced.md`.

---

## Pattern Reference Matrix

| Pattern | Solves | When to Use | Complexity |
|---------|--------|-------------|------------|
| 1. Agent-Directive Response | Agent doesn't know next step | **ALWAYS** — Every tool response | Low |
| 2. Confidence-Gated Response | Preventing low-confidence actions | High-risk operations (payments, deletions) | Medium |
| 3. Structured Error Recovery | Agent retry loops, unclear failures | All error scenarios | Medium |
| 4. Progressive Disclosure | Large payloads, slow operations | Data-heavy APIs, multi-stage queries | Medium |
| 5. Resource Linking (HATEOAS) | Agent doesn't see related actions | REST APIs, workflow navigation | Low |
| 6. Idempotency & Safe Retry | Duplicate operations on retry | POST/PUT/DELETE operations | Medium |
| 7. Context Carryover | Lost context across tool calls | Multi-turn workflows, sessions | High |
| 8. Capability Advertisement | Agent uses tool incorrectly | Complex tools with limits | Low |
| 9. Circuit Breaker Status | Repeated failures to dead services | External API integrations | Medium |
| 10. Audit Trail | Debugging agent decisions | Compliance, debugging, production | Low |

Patterns 6-10 are in [agent-design-patterns-advanced.md](agent-design-patterns-advanced.md).

---

## Pattern 1: Agent-Directive Response (ALWAYS USE)

**Problem**: Agent receives data but doesn't know what to do next.

**Solution**: Every tool response includes `next_actions`, `suggestion`, and `context` to guide the agent's next move.

### TypeScript Interface

```typescript
interface AgentResponse<T> {
  data: T;
  next_actions: string[];           // Explicit next steps agent should consider
  suggestion: string;                // Natural language guidance
  context: Record<string, unknown>;  // Key-value pairs for follow-up tools
}
```

### Helper Function

```typescript
function formatAgentResponse<T>(
  data: T,
  nextActions: string[],
  suggestion: string,
  context: Record<string, unknown> = {}
): AgentResponse<T> {
  return {
    data,
    next_actions: nextActions,
    suggestion,
    context
  };
}
```

### Usage in Tool Handler (Modern MCP SDK)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "example-server", version: "1.0.0" });

// Register tool with modern API
server.registerTool(
  "get_user",
  {
    title: "Get User",
    description: "Fetches user profile by ID",
    inputSchema: {
      user_id: z.string().describe("The user ID to fetch")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  async ({ user_id }) => {
    const user = await fetchUser(user_id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(formatAgentResponse(
            user,
            [
              "fetch_user_orders",
              "fetch_user_preferences",
              "update_user_profile"
            ],
            `User ${user.name} found. You can now fetch their orders or update their profile.`,
            {
              user_id: user.id,
              has_premium: user.subscription === "premium",
              last_login: user.last_login
            }
          ), null, 2)
        }
      ]
    };
  }
);
```

### Example JSON Output

```json
{
  "data": {
    "id": "usr_123",
    "name": "Alice",
    "email": "alice@example.com",
    "subscription": "premium"
  },
  "next_actions": [
    "fetch_user_orders",
    "fetch_user_preferences",
    "update_user_profile"
  ],
  "suggestion": "User Alice found. You can now fetch their orders or update their profile.",
  "context": {
    "user_id": "usr_123",
    "has_premium": true,
    "last_login": "2026-02-01T10:30:00Z"
  }
}
```

---

## Pattern 2: Confidence-Gated Response

**Problem**: Agent executes high-risk actions with low confidence, causing errors or unwanted operations.

**Solution**: Tools return confidence scores and guidance when confidence is below threshold.

### TypeScript Interface

```typescript
interface ConfidenceGatedResponse<T> {
  data: T | null;
  confidence: number;              // 0.0 - 1.0
  confidence_threshold: number;    // Minimum required confidence
  below_threshold_action: string;  // What agent should do if confidence too low
  reasoning: string;               // Why confidence is low/high
}
```

### Example JSON Output

```json
{
  "data": null,
  "confidence": 0.45,
  "confidence_threshold": 0.80,
  "below_threshold_action": "escalate_to_human",
  "reasoning": "Ambiguous deletion request - 'last order' could mean most recent or final. User has 3 orders from today. Recommend asking user to specify order ID explicitly."
}
```

**When confidence is high:**

```json
{
  "data": {
    "order_id": "ord_999",
    "status": "cancelled",
    "refund_amount": 49.99
  },
  "confidence": 0.95,
  "confidence_threshold": 0.80,
  "below_threshold_action": "proceed",
  "reasoning": "Clear order ID provided (ord_999), user confirmed cancellation intent, refund policy allows cancellation within 24 hours."
}
```

---

## Pattern 3: Structured Error Recovery

**Problem**: Agent receives generic error messages and enters retry loops without fixing the issue.

**Solution**: Errors include recovery actions, retry timing, fallback tools, and corrective parameters.

### TypeScript Interface

```typescript
interface StructuredError {
  code: string;                    // Machine-readable error code
  message: string;                 // Human-readable message
  retry_after_ms?: number;         // Wait time before retry (null = don't retry)
  recovery_actions: string[];      // Steps agent should take
  fallback_tool?: string;          // Alternative tool to try
  corrective_params?: Record<string, unknown>;  // Fixed parameters to use
}
```

### Example JSON Output (Rate Limit)

```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "API rate limit exceeded: 100 requests/minute",
  "retry_after_ms": 12000,
  "recovery_actions": [
    "wait_12_seconds",
    "retry_with_same_params"
  ],
  "fallback_tool": null,
  "corrective_params": null
}
```

### Example JSON Output (Invalid Parameter)

```json
{
  "code": "INVALID_DATE_FORMAT",
  "message": "Date must be in ISO 8601 format (YYYY-MM-DD)",
  "retry_after_ms": null,
  "recovery_actions": [
    "reformat_date_to_iso8601",
    "retry_with_corrected_params"
  ],
  "fallback_tool": null,
  "corrective_params": {
    "date": "2026-02-02",
    "original_input": "2/2/2026"
  }
}
```

---

## Pattern 4: Progressive Disclosure

**Problem**: Large responses cause token overflow; agent needs summary first, details on demand.

**Solution**: Return summary with metadata about available details and how to fetch them.

### TypeScript Interface

```typescript
interface ProgressiveResponse<TSummary, TDetail> {
  summary: TSummary;
  detail_available: boolean;
  detail_tool: string;           // Tool to call for full details
  detail_params: Record<string, unknown>;  // Params to pass to detail_tool
}
```

### Example JSON Output

```json
{
  "summary": {
    "total_orders": 1247,
    "date_range": "2025-01-01 to 2026-02-02",
    "total_revenue": 98543.21,
    "top_product": "Widget Pro"
  },
  "detail_available": true,
  "detail_tool": "get_orders_detail",
  "detail_params": {
    "date_range": "2025-01-01/2026-02-02",
    "page_size": 100,
    "include_line_items": true
  }
}
```

---

## Pattern 5: Resource Linking (HATEOAS)

**Problem**: Agent doesn't discover related actions or navigate workflows.

**Solution**: Include hypermedia links and available actions in every response.

### TypeScript Interface

```typescript
interface LinkedResponse<T> {
  data: T;
  links: {
    self: string;
    related?: string[];
  };
  available_actions: Array<{
    name: string;
    tool: string;
    params: Record<string, unknown>;
  }>;
}
```

### Example JSON Output

```json
{
  "data": {
    "order_id": "ord_456",
    "status": "shipped",
    "tracking_number": "1Z999AA1234567890"
  },
  "links": {
    "self": "mcp://orders/ord_456",
    "related": [
      "mcp://users/usr_123",
      "mcp://shipments/shp_789"
    ]
  },
  "available_actions": [
    {
      "name": "Track shipment",
      "tool": "track_shipment",
      "params": { "tracking_number": "1Z999AA1234567890" }
    },
    {
      "name": "Cancel order",
      "tool": "cancel_order",
      "params": { "order_id": "ord_456" }
    },
    {
      "name": "Contact customer",
      "tool": "get_user",
      "params": { "user_id": "usr_123" }
    }
  ]
}
```
