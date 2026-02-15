# MCP Design Patterns for Autonomous Agents — Advanced

This reference covers patterns 6-10 plus domain-specific presets and tool design guidelines. For core patterns 1-5, read `agent-design-patterns.md`.

---

## Pattern 6: Idempotency & Safe Retry

**Problem**: Agent retries failed requests, creating duplicate orders/payments.

**Solution**: Use idempotency keys and return whether operation was already processed.

### TypeScript Interface

```typescript
interface IdempotentResponse<T> {
  idempotency_key: string;
  already_processed: boolean;
  original_result?: T;         // Result from first execution
  current_result: T;           // Same as original_result if already_processed
  message: string;
}
```

### Example JSON Output (First Call)

```json
{
  "idempotency_key": "create_order_usr123_20260202_143022",
  "already_processed": false,
  "original_result": null,
  "current_result": {
    "order_id": "ord_789",
    "status": "created",
    "total": 129.99
  },
  "message": "Order created successfully"
}
```

### Example JSON Output (Retry)

```json
{
  "idempotency_key": "create_order_usr123_20260202_143022",
  "already_processed": true,
  "original_result": {
    "order_id": "ord_789",
    "status": "created",
    "total": 129.99
  },
  "current_result": {
    "order_id": "ord_789",
    "status": "created",
    "total": 129.99
  },
  "message": "Order was already created with this idempotency key. Returning original result."
}
```

---

## Pattern 7: Context Carryover

**Problem**: Agent loses context between tool calls in multi-step workflows.

**Solution**: Include session/conversation IDs and structured context to carry forward.

### TypeScript Interface

```typescript
interface ContextAwareResponse<T> {
  data: T;
  session_id?: string;
  conversation_id?: string;
  carry_forward: Record<string, unknown>;  // Context for next tool call
  next_tool_hint?: string;
}
```

### Example JSON Output

```json
{
  "data": {
    "items_in_cart": 3,
    "cart_total": 87.50
  },
  "session_id": "sess_abc123",
  "conversation_id": "conv_xyz789",
  "carry_forward": {
    "cart_id": "cart_456",
    "user_id": "usr_123",
    "selected_shipping": "express",
    "payment_method_id": "pm_card_end_4242",
    "workflow_step": "review_before_checkout"
  },
  "next_tool_hint": "checkout_cart"
}
```

---

## Pattern 8: Capability Advertisement

**Problem**: Agent tries to use tool beyond its capabilities (file size, formats, rate limits).

**Solution**: Tools advertise capabilities, limits, and cost estimates upfront.

### TypeScript Interface

```typescript
interface CapabilityResponse {
  tool: string;
  capabilities: string[];
  max_file_size_mb?: number;
  supported_operations: string[];
  limitations: string[];
  cost_estimate?: {
    credits_per_call?: number;
    rate_limit?: string;
  };
}
```

### Example JSON Output

```json
{
  "tool": "image_analysis",
  "capabilities": [
    "object_detection",
    "ocr",
    "face_detection",
    "image_classification"
  ],
  "max_file_size_mb": 10,
  "supported_operations": [
    "analyze_image",
    "extract_text",
    "detect_faces"
  ],
  "limitations": [
    "PNG, JPEG, WebP only",
    "Max resolution: 4096x4096",
    "No video support",
    "OCR limited to English, Spanish, French"
  ],
  "cost_estimate": {
    "credits_per_call": 5,
    "rate_limit": "100 requests/hour"
  }
}
```

---

## Pattern 9: Circuit Breaker Status

**Problem**: Agent repeatedly calls a failing external service, wasting time and resources.

**Solution**: Tools expose circuit breaker state and recommend fallback actions.

### TypeScript Interface

```typescript
interface CircuitBreakerStatus {
  service: string;
  circuit_state: "closed" | "open" | "half_open";
  failure_rate: number;            // 0.0 - 1.0
  last_success?: string;           // ISO 8601 timestamp
  recommendation: string;
  fallback_tool?: string;
  expected_recovery?: string;      // ISO 8601 timestamp
}
```

### Example JSON Output (Circuit Open)

```json
{
  "service": "payment_gateway",
  "circuit_state": "open",
  "failure_rate": 0.95,
  "last_success": "2026-02-02T14:22:00Z",
  "recommendation": "Use fallback payment processor or retry after 15 minutes",
  "fallback_tool": "fallback_payment_processor",
  "expected_recovery": "2026-02-02T14:45:00Z"
}
```

### Example JSON Output (Circuit Closed)

```json
{
  "service": "payment_gateway",
  "circuit_state": "closed",
  "failure_rate": 0.02,
  "last_success": "2026-02-02T14:30:00Z",
  "recommendation": "Service healthy - proceed normally",
  "fallback_tool": null,
  "expected_recovery": null
}
```

---

## Pattern 10: Audit Trail

**Problem**: Cannot debug agent decisions or trace data sources in production.

**Solution**: Include correlation ID, tool chain, data sources, and metadata in every response.

### TypeScript Interface

```typescript
interface AuditedResponse<T> {
  data: T;
  correlation_id: string;          // Unique ID for this request chain
  tool_chain: string[];            // Sequence of tools called
  data_sources: string[];          // APIs, DBs, files accessed
  timestamp: string;               // ISO 8601
  model_version?: string;          // If using ML models
  human_reviewable: boolean;       // Flag for compliance review
}
```

### Example JSON Output

```json
{
  "data": {
    "fraud_risk_score": 0.82,
    "recommendation": "block_transaction"
  },
  "correlation_id": "req_20260202_143045_abc123",
  "tool_chain": [
    "get_user",
    "get_transaction_history",
    "analyze_fraud_risk"
  ],
  "data_sources": [
    "postgres://users_db",
    "https://api.frauddetection.example.com/v2/analyze",
    "redis://cache_cluster"
  ],
  "timestamp": "2026-02-02T14:30:45Z",
  "model_version": "fraud-detector-v2.3.1",
  "human_reviewable": true
}
```

---

## Domain-Based Pattern Selection Presets

### Weather / Public Data APIs
```yaml
required_patterns: [1, 3, 8]
Pattern 1: Always guide next actions
Pattern 3: Handle API errors gracefully
Pattern 8: Advertise rate limits and coverage
```

### Payment / Financial APIs
```yaml
required_patterns: [1, 2, 3, 6, 9, 10]
Pattern 1: Guide agent through payment flow
Pattern 2: Confidence gates for high-value transactions
Pattern 3: Structured error recovery for payment failures
Pattern 6: Idempotency for duplicate payment prevention
Pattern 9: Circuit breaker for payment gateway outages
Pattern 10: Audit trail for compliance and fraud investigation
```

### Healthcare APIs
```yaml
required_patterns: [1, 2, 3, 4, 6, 7, 9, 10]
Pattern 1: Guide clinical workflows
Pattern 2: Confidence gates for diagnoses and prescriptions
Pattern 3: Structured error recovery for critical failures
Pattern 4: Progressive disclosure for large patient records
Pattern 6: Idempotency for medication orders
Pattern 7: Session context for multi-step appointments
Pattern 9: Circuit breaker for EHR system outages
Pattern 10: Audit trail for HIPAA compliance
escalate_to_human: MANDATORY for prescriptions, diagnoses, life-safety
```

### E-Commerce APIs
```yaml
required_patterns: [1, 3, 4, 5, 6, 7, 10]
Pattern 1: Guide shopping workflows
Pattern 3: Structured error recovery for checkout failures
Pattern 4: Progressive disclosure for large product catalogs
Pattern 5: Resource linking for product discovery
Pattern 6: Idempotency for order creation
Pattern 7: Session context for multi-step checkout
Pattern 10: Audit trail for fraud detection
```

### Trading / Autonomous Trading Agents
```yaml
required_patterns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
ALL_PATTERNS: Maximum safety and auditability
escalate_to_human: MANDATORY for trades >$10k, margin calls, unusual volatility
```

---

## Tool Design: Intent-Based Consolidation

### Anti-Pattern: CRUD Explosion (6+ Tools)

```typescript
// BAD: 6 tools for basic user operations
server.registerTool("create_user", ...);
server.registerTool("get_user", ...);
server.registerTool("update_user", ...);
server.registerTool("delete_user", ...);
server.registerTool("list_users", ...);
server.registerTool("search_users", ...);
```

**Problems:**
- Agent confused about which tool to use
- Increased prompt size (all tools sent to model)
- Redundant parameter validation
- Hard to maintain consistent error handling

### Correct Pattern: Intent-Based Consolidation (2 Tools)

```typescript
// GOOD: 2 intent-based tools
server.registerTool(
  "manage_user",
  {
    title: "Manage User",
    description: "Create, update, or delete a user",
    inputSchema: {
      action: z.enum(["create", "update", "delete"]).describe("The action to perform"),
      user_id: z.string().optional().describe("Required for update/delete"),
      user_data: z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
        role: z.enum(["user", "admin"]).optional()
      }).optional().describe("Required for create/update")
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  },
  async ({ action, user_id, user_data }) => {
    // Single handler with consolidated logic
    switch (action) {
      case "create":
        return createUser(user_data);
      case "update":
        return updateUser(user_id, user_data);
      case "delete":
        return deleteUser(user_id);
    }
  }
);

server.registerTool(
  "query_users",
  {
    title: "Query Users",
    description: "Search or list users with filters",
    inputSchema: {
      search_term: z.string().optional(),
      role: z.enum(["user", "admin"]).optional(),
      limit: z.number().default(50),
      offset: z.number().default(0)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  async ({ search_term, role, limit, offset }) => {
    return queryUsers({ search_term, role, limit, offset });
  }
);
```

### Tool Count Guidelines

| Tool Count | Status | Action |
|------------|--------|--------|
| 10-15 | Ideal | Proceed |
| 16-25 | Acceptable | Review for consolidation opportunities |
| 26-30 | Warning | Consolidate or split into multiple MCP servers |
| 31+ | Critical | MUST consolidate — agent performance will degrade |

**Rule of Thumb:**
- **Write operations** (create, update, delete): 1-2 tools per entity
- **Read operations** (get, list, search): 1 tool per entity
- **Workflow tools** (checkout, submit_form, process_order): 1 tool per workflow
- **Utility tools** (calculate, validate, format): Consolidate into domain-specific tools

---

## `escalate_to_human` Tool Requirement

For high-risk domains, MCP servers SHOULD implement an `escalate_to_human` tool.

### When Required

- Life-safety decisions (healthcare, autonomous vehicles)
- Fraud detection and account security
- High-value financial transactions (>$1000 or domain threshold)
- Legal/compliance decisions
- Ambiguous user intent with confidence < threshold

### Implementation Example

```typescript
server.registerTool(
  "escalate_to_human",
  {
    title: "Escalate to Human",
    description: "Escalate decision to human operator",
    inputSchema: {
      reason: z.string().describe("Why escalation is needed"),
      context: z.record(z.unknown()).describe("Relevant context for human reviewer"),
      urgency: z.enum(["low", "medium", "high", "critical"]),
      suggested_action: z.string().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ reason, context, urgency, suggested_action }) => {
    const ticket = await createEscalationTicket({
      reason,
      context,
      urgency,
      suggested_action,
      timestamp: new Date().toISOString()
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            escalation_id: ticket.id,
            status: "escalated",
            estimated_response_time_minutes: urgency === "critical" ? 5 : 30,
            message: "Request escalated to human operator. Do not proceed until human review is complete.",
            next_actions: ["wait_for_human_response"],
            context: {
              escalation_id: ticket.id,
              check_tool: "check_escalation_status"
            }
          }, null, 2)
        }
      ]
    };
  }
);
```

---

## Summary: Pattern Adoption Checklist

- [ ] **Pattern 1 (Agent-Directive Response)** — Used in EVERY tool response
- [ ] **Pattern 3 (Structured Error Recovery)** — Used in ALL error scenarios
- [ ] **Tool count** — Between 10-25 tools (consolidate if >25)
- [ ] **Idempotency** — All write operations use Pattern 6
- [ ] **Confidence gates** — High-risk operations use Pattern 2
- [ ] **Circuit breakers** — External APIs use Pattern 9
- [ ] **Audit trail** — Compliance-critical domains use Pattern 10
- [ ] **`escalate_to_human`** — Implemented for high-risk domains

**Next Steps:**
1. Read `mcp-server-template.md` for modern SDK implementation examples
2. Use `server.registerTool()` API (NOT deprecated `server.tool()` or `setRequestHandler`)
3. Return responses in `{ content: [{ type: "text", text: JSON.stringify(...) }] }` format
4. Test with autonomous agent workflows, not just single tool calls
