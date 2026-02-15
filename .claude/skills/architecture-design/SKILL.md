---
name: architecture-design
description: This skill should be used when designing system architecture, API contracts, deployment topologies, or making technology decisions for full-stack applications.
argument-hint: "[system or feature to design]"
allowed-tools: Bash, Read, Write, Edit
---

# Architecture Design Skill

Design system architecture, API contracts, deployment topologies, and technology decisions for full-stack applications.

**Supported Design Artifacts:**
- System context diagrams (C4 model, Mermaid)
- Sequence diagrams (service interactions)
- API contracts (OpenAPI 3.x)
- Deployment topologies (Docker Compose)
- Architecture Decision Records (ADRs)

**Process:**

1. **Analyze Request**
   - Identify which artifacts the user needs
   - Determine scope: single service, multi-service, full system

2. **Load Templates**
   - Read [reference/architecture-templates.md](reference/architecture-templates.md) for diagram and deployment templates
   - For detailed ADR workflows: delegate to the `architecture-decision-records` skill
   - For full OpenAPI spec generation: delegate to the `openapi-spec-generation` skill

3. **Generate Artifacts**
   - Use loaded templates as starting points
   - Adapt to the project's tech stack (Spring Boot, Node.js, Angular, Flutter, PostgreSQL, Firebase)
   - Follow conventions from CLAUDE.md (package structure, naming, reactive patterns)

4. **Present and Iterate**
   - Show generated artifacts with explanations
   - Offer refinement options (add services, change patterns, adjust topology)

## Documentation Sources

Before making architecture decisions, consult these sources:

| Source | URL / Tool | Purpose |
|--------|-----------|---------|
| Docker | `https://docs.docker.com/llms.txt` | Container config, Compose, multi-stage builds |
| MCP Protocol | `https://modelcontextprotocol.io/llms-full.txt` | MCP integration architecture and patterns |
| All libraries | `Context7` MCP | Latest API references for any technology |

## Error Handling

**Unclear artifact type**: Ask user to specify (diagram, API contract, deployment, ADR).

**Ambiguous tech stack**: Default to project conventions in CLAUDE.md or ask for clarification if multiple options exist.
