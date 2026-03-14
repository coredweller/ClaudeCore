---
description: Scaffold a new Python 3.13 FastAPI project with Pydantic, async SQLAlchemy, and proper structure
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit
disable-model-invocation: true
---

# Scaffold Python FastAPI Service

Create a new Python 3.13 / FastAPI project with the following:

**Project name:** $ARGUMENTS (default to "my-python-api" if not provided)

## Steps
1. Initialize project with `pyproject.toml` (dependencies + dev dependencies)
2. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to Python or general cross-cutting concerns like `code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`, and `code-reviewer`. Include the cross-cutting agents like `architect.md`, `sql-expert.md`, `security-reviewer.md`, `postgresql-database-reviewer.md`, and `dedup-code-agent.md`. Include the required skills folders as well such as `agentic-ai-dev` and `database-schema-designer`.
3. Set up virtual environment with `uv init` or `python -m venv`
4. Create folder structure: `src/<package>/api/routes/`, `models/`, `services/`, `repositories/`, `core/`, `utils/`
5. Create `main.py` with FastAPI app, lifespan handler, and router includes
6. Create `core/config.py` with pydantic-settings
7. Create a sample Pydantic model (request + response)
8. Create a sample route handler, service, and repository
9. Add a health check endpoint at `GET /api/v1/health`
10. Create `tests/conftest.py` with async test client fixture
11. Add a pytest test for the sample endpoint
12. Configure ruff (linting) and mypy (type checking) in pyproject.toml
13. Create a `Dockerfile` for production
14. Add a `.env.example` file
15. Print summary of created files and next steps

Use the python-dev skill for patterns and templates.
