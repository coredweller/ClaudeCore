---
name: mcp-builder
description: This skill should be used when building MCP (Model Context Protocol) servers to integrate external APIs or services. It provides guides for Python (FastMCP) and Node/TypeScript (MCP SDK) implementations.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
---

# MCP Server Development Guide

Create MCP servers that enable LLMs to interact with external services through well-designed tools.

## High-Level Workflow

### Phase 1: Research and Plan

- Study MCP spec from `https://modelcontextprotocol.io/sitemap.xml` (append `.md` for markdown)
- Fetch TypeScript SDK README from `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Fetch Python SDK README from `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- Load design principles, agent patterns, and error taxonomy from reference files (see table below)

### Phase 2: Implement

- Set up project structure using language-specific reference files (see table below)
- Create shared utilities: API client, error handling, response formatting, pagination
- For each tool: define input schema (Zod/Pydantic), output schema, description, annotations, and async implementation
- **Recommended stack**: TypeScript with streamable HTTP (remote) or stdio (local)

### Phase 3: Review and Test

- Review for: no duplication, consistent error handling, full type coverage, clear tool descriptions
- TypeScript: `npm run build` then test with `npx @modelcontextprotocol/inspector`
- Python: `python -m py_compile your_server.py` then test with MCP Inspector

### Phase 4: Create Evaluations

- Create 10 complex, realistic evaluation questions requiring multiple tool calls
- Each question must be: independent, read-only, complex, realistic, verifiable, stable
- Output as XML with `<evaluation>` root containing `<qa_pair>` elements

## Tool Implementation Checklist

For each tool, define:
- **Input schema** — Zod (TypeScript) or Pydantic (Python) with constraints and descriptions
- **Output schema** — Use `outputSchema` and `structuredContent` where possible
- **Description** — Concise summary, parameter docs, return type
- **Annotations** — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
- **Implementation** — Async/await, proper error handling, pagination support
- **Agent directive** — Include `next_actions` and `suggestion` in every response
- **Error taxonomy** — Use `MCPErrorCode` enum with recovery actions

## Reference Files

| Resource | When to Load |
|----------|-------------|
| [MCP Design Principles](reference/mcp-design-principles.md) | Phase 1 — naming, tool design, response formats |
| [MCP Quality Standards](reference/mcp-quality-standards.md) | Phase 1 — security, annotations, testing |
| [Agent Design Patterns — Core](reference/agent-design-patterns.md) | Phase 1 — patterns 1-5: directive, confidence, error, disclosure, linking |
| [Agent Design Patterns — Advanced](reference/agent-design-patterns-advanced.md) | Phase 1/2 — patterns 6-10 + domain presets + tool design |
| [Error Taxonomy](reference/error-taxonomy.md) | Phase 1 — error codes, recovery hints, no-fake-empty-data |
| [Branded Types & Audit](reference/error-branded-types-audit.md) | Phase 2 — type-safe IDs, Zod integration, audit logging |
| [TypeScript Setup](reference/node-mcp-setup.md) | Phase 2 — project structure, package config, build |
| [TypeScript Patterns](reference/node-mcp-patterns.md) | Phase 2 — tools, Zod, pagination, errors |
| [TypeScript Advanced](reference/node-mcp-advanced.md) | Phase 2 — complete example, resources, transport |
| [Python Setup](reference/python-mcp-setup.md) | Phase 2 — Python SDK, tool structure, Pydantic |
| [Python Patterns](reference/python-mcp-patterns.md) | Phase 2 — pagination, errors, complete example |
| [Python Advanced](reference/python-mcp-advanced.md) | Phase 2 — context, resources, lifespan, quality |
| [Resilience Patterns](reference/resilience-patterns.md) | Phase 2 — circuit breaker, bulkhead, rate limiter, retry |
| [Security Architecture](reference/security-architecture.md) | Phase 2 — input sanitization, attack detection |
| [Observability Patterns](reference/observability-patterns.md) | Phase 2 — OpenTelemetry tracing, metrics |
| [Production Runtime — Shutdown & Health](reference/production-runtime-shutdown-health.md) | Phase 2 — graceful shutdown, K8s health checks |
| [Production Runtime — Multi-Tenant](reference/production-runtime-multi-tenant.md) | Phase 2 — AsyncLocalStorage context, quotas, audit |
| [Production Infrastructure](reference/production-deployment-infra.md) | Phase 2 — Docker, K8s manifests, CI/CD |
| [Evaluation Criteria](reference/evaluation-criteria.md) | Phase 4 — question/answer design |
| [Evaluation Running](reference/evaluation-running.md) | Phase 4 — CLI, setup, troubleshooting |

## Error Handling

> For the full error taxonomy and circuit breaker patterns, Read [reference/error-taxonomy.md](reference/error-taxonomy.md)

**Server startup failures**: Validate all required environment variables at startup. Fail fast with a clear error message — never silently fall back to defaults.

**Tool execution errors**: Return structured MCP error responses with error codes. Never let unhandled exceptions crash the server.
