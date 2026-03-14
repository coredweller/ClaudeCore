---
description: Scaffold a new Agentic AI service with Python 3.13, LangChain v1.2.8, LangGraph v1.0.7, FastAPI 0.128.x, and production infrastructure
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit
disable-model-invocation: true
---

# Scaffold Agentic AI Service

**Project name:** $ARGUMENTS (default to "my-agent-service" if not provided)

Delegate to the `agentic-ai-dev` skill for all patterns, templates, and reference files.

## Steps

1. Read the `agentic-ai-dev` skill and its reference files for exact code templates
2. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to Python/AI or general cross-cutting concerns like `code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`, and `code-reviewer`. Include the cross-cutting agents like `architect.md`, `security-reviewer.md`, and `agentic-ai-reviewer.md`. Include the required skills folders as well such as `agentic-ai-dev` and `agentic-ai-coding-standard`.
3. Initialize project — `uv init $ARGUMENTS --python 3.13`
4. Add production + dev dependencies per skill reference `agentic-config-project.md`
5. Create directory structure under `src/<service_name>/` per skill conventions
6. Create core modules (config, logging, exceptions), agent layer (state, tools, nodes, graph), LLM providers, API layer (FastAPI + routes), and tests using skill reference templates
7. Add infrastructure (Dockerfile, docker-compose.dev.yml, .env)
8. Verify — `ruff check src/` and `mypy src/`
