# MCP Server Best Practices

## Quick Reference

### Server Naming
- **Python**: `{service}_mcp` (e.g., `slack_mcp`)
- **Node/TypeScript**: `{service}-mcp-server` (e.g., `slack-mcp-server`)

### Tool Naming
- Use snake_case with service prefix
- Format: `{service}_{action}_{resource}`
- Example: `slack_send_message`, `github_create_issue`

### Response Formats
- Support both JSON and Markdown formats
- JSON for programmatic processing
- Markdown for human readability

### Pagination
- Always respect `limit` parameter
- Return `has_more`, `next_offset`, `total_count`
- Default to 20-50 items

### Agent-Directive Responses
- Every tool response MUST include `next_actions` (machine-readable) and `suggestion` (human-readable)
- Use `formatAgentResponse<T>()` helper (see agent-design-patterns.md)
- Include `context` for state chaining between tool calls

### Tool Count Limits
- IDEAL: 10-15 tools — optimal agent performance
- ACCEPTABLE: 16-25 tools — manageable with good descriptions
- WARNING: 26-30 tools — consider consolidation
- CRITICAL: 31+ tools — agent decision paralysis

### Transport
- **Streamable HTTP**: For remote servers, multi-client scenarios
- **stdio**: For local integrations, command-line tools
- Avoid SSE (deprecated in favor of streamable HTTP)

---

## Primitives Decision Framework

MCP has three core primitives. Choosing the right one affects agent performance:

| Primitive | Controlled By | Best For | Examples |
|-----------|---------------|----------|----------|
| **Tools** | Model (LLM invokes) | Actions, dynamic queries, side effects | `create_issue`, `search_users`, `send_email` |
| **Resources** | Application (context injection) | Static data, docs, configuration | `file://config.json`, `db://schema`, API docs |
| **Prompts** | User (explicit trigger) | Workflow templates, analysis recipes | `code_review`, `summarize_data`, `debug_error` |

**Decision guide:**
- Does it *do* something or *change* state? -> **Tool**
- Does it *provide* context the model should see? -> **Resource**
- Is it a *reusable workflow* a user triggers? -> **Prompt**

---

## Intent-First Design

### The 25-Tool Performance Cliff

Agent performance degrades significantly beyond 25 tools. Research shows:
- **10-15 tools**: Optimal agent decision accuracy
- **16-25 tools**: Acceptable with clear, distinct descriptions
- **26-30 tools**: Noticeable degradation in tool selection accuracy
- **31+ tools**: Severe decision paralysis — agents pick wrong tools or fail to act

### The 3-Step Rule

If accomplishing a single user intent requires more than 3 sequential tool calls, the tool design is too granular. Consolidate related operations into higher-level intent-based tools.

### 7 MCP Anti-Patterns

| Anti-Pattern | What Happens | Fix |
|---|---|---|
| **Tool Explosion** | One tool per API endpoint (50+ tools) | Consolidate by user intent |
| **Atomic Obsession** | Every field is a separate tool call | Bundle related operations |
| **Developer-First Descriptions** | "Executes POST /api/v1/users" | "Create a new user account with name and email" |
| **Missing Examples** | No usage examples in descriptions | Add 1-2 example inputs/outputs per tool |
| **Auto-Generation Without Curation** | OpenAPI -> tools without review | Curate: merge, rename, add context |
| **REST Trap** | CRUD maps 1:1 to tools | Design around user workflows, not endpoints |
| **Context Window Neglect** | Tools return 50KB JSON blobs | Paginate, summarize, progressive disclosure |

### Agent Stories Framework

Design tools by mapping user intent:

1. **Map intent**: "As an agent, I need to ___"
2. **Consolidate by intent**: Group API calls that serve one intent into one tool
3. **Write agent-directive responses**: Every response tells the agent what to do next

### When to Split vs Combine Tools

Split a tool into multiple when:
- **Safety Boundary**: Read vs write operations need different authorization
- **Context Boundary**: Tool would need >5 unrelated parameters
- **Logic Boundary**: Handler exceeds ~200 lines or has completely different error paths

### The "3 AM Test"

Imagine an on-call engineer debugging agent behavior at 3 AM. Can they tell from the tool name and description what it does, without reading the code? If not, rename or add clarity.

---

## Server Naming Conventions

Follow these standardized naming patterns:

**Python**: Use format `{service}_mcp` (lowercase with underscores)
- Examples: `slack_mcp`, `github_mcp`, `jira_mcp`

**Node/TypeScript**: Use format `{service}-mcp-server` (lowercase with hyphens)
- Examples: `slack-mcp-server`, `github-mcp-server`, `jira-mcp-server`

The name should be general, descriptive of the service being integrated, easy to infer from the task description, and without version numbers.

---

## Tool Naming and Design

### Tool Naming

1. **Use snake_case**: `search_users`, `create_project`, `get_channel_info`
2. **Include service prefix**: Anticipate that your MCP server may be used alongside other MCP servers
   - Use `slack_send_message` instead of just `send_message`
   - Use `github_create_issue` instead of just `create_issue`
3. **Be action-oriented**: Start with verbs (get, list, search, create, etc.)
4. **Be specific**: Avoid generic names that could conflict with other servers

### Tool Design

- Tool descriptions must narrowly and unambiguously describe functionality
- Descriptions must precisely match actual functionality
- Provide tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
- Keep tool operations focused and atomic

### Intent-Based Tool Consolidation

Consolidate CRUD operations into intent-based tools to reduce agent cognitive load:

```typescript
// WRONG: 6 separate tools (decision paralysis for agents)
tools: ["createUser", "readUser", "updateUser", "deleteUser", "getUserById", "searchUsers"]

// RIGHT: 2 intent-based tools (clear purpose)
tools: ["manageUser", "searchUsers"]

// manageUser tool definition
{
  name: "manageUser",
  description: "Unified user management (create/read/update/delete)",
  inputSchema: z.object({
    action: z.enum(["create", "read", "update", "delete"]),
    userId: z.string().optional(),
    data: z.record(z.any()).optional(),
  }),
}
```

### escalate_to_human Tool

MCP servers SHOULD include an `escalate_to_human` tool for high-risk domains:

**Required for:**
- Life-safety decisions (healthcare, autonomous systems)
- Fraud detection and account security
- Financial operations >$1,000 (or domain-specific threshold)
- Legal/compliance decisions

**Not required for:**
- Read-only or public-data servers (weather, documentation, search)
- Low-risk CRUD operations with no financial or safety impact
- Development/testing tools

```typescript
server.registerTool(
  "escalate_to_human",
  {
    title: "Escalate to Human",
    description: "Escalate to human operator for review. MUST be used for life-safety, fraud, or high-value decisions.",
    inputSchema: {
      reason: z.string().describe("Why human review is needed"),
      severity: z.enum(["low", "medium", "high", "critical"]),
      context: z.record(z.any()).describe("Relevant context for the human reviewer"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ reason, severity, context }) => {
    // Log escalation and notify human operator
    return {
      content: [{ type: "text", text: JSON.stringify({
        success: true,
        data: { escalation_id: generateId(), status: "pending_review" },
        next_actions: ["check_escalation_status"],
        suggestion: "Escalation submitted. Wait for human review before proceeding.",
      })}]
    };
  }
);
```

---

## Response Formats

All tools that return data should support multiple formats:

### JSON Format (`response_format="json"`)
- Machine-readable structured data
- Include all available fields and metadata
- Consistent field names and types
- Use for programmatic processing

### Markdown Format (`response_format="markdown"`, typically default)
- Human-readable formatted text
- Use headers, lists, and formatting for clarity
- Convert timestamps to human-readable format
- Show display names with IDs in parentheses
- Omit verbose metadata

---

## Pagination

For tools that list resources:

- **Always respect the `limit` parameter**
- **Implement pagination**: Use `offset` or cursor-based pagination
- **Return pagination metadata**: Include `has_more`, `next_offset`/`next_cursor`, `total_count`
- **Never load all results into memory**: Especially important for large datasets
- **Default to reasonable limits**: 20-50 items is typical

Example pagination response:
```json
{
  "total": 150,
  "count": 20,
  "offset": 0,
  "items": [...],
  "has_more": true,
  "next_offset": 20
}
```

---

## Transport Options

### Streamable HTTP

**Best for**: Remote servers, web services, multi-client scenarios

**Characteristics**:
- Bidirectional communication over HTTP
- Supports multiple simultaneous clients
- Can be deployed as a web service
- Enables server-to-client notifications

**Use when**:
- Serving multiple clients simultaneously
- Deploying as a cloud service
- Integration with web applications

### stdio

**Best for**: Local integrations, command-line tools

**Characteristics**:
- Standard input/output stream communication
- Simple setup, no network configuration needed
- Runs as a subprocess of the client

**Use when**:
- Building tools for local development environments
- Integrating with desktop applications
- Single-user, single-session scenarios

**Note**: stdio servers should NOT log to stdout (use stderr for logging)

### Transport Selection

| Criterion | stdio | Streamable HTTP |
|-----------|-------|-----------------|
| **Deployment** | Local | Remote |
| **Clients** | Single | Multiple |
| **Complexity** | Low | Medium |
| **Real-time** | No | Yes |
