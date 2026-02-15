---
description: Review code for quality, security, and maintainability. Delegates to the appropriate reviewer agent based on the tech stack detected.
allowed-tools: Bash, Read, Glob, Grep, Task
---

# Code Review

Review the specified code for quality, security, and maintainability.

## Process

1. **Detect scope** — determine which files/directories to review from `$ARGUMENTS` (default: recent changes via `git diff`)
2. **Identify tech stack** — based on file extensions and project structure, select the right reviewer:
   - `.java` files → delegate to `spring-reactive-reviewer` agent
   - `.ts` files under NestJS project → delegate to `nestjs-reviewer` agent
   - `.ts`/`.html` files under Angular project → delegate to `code-reviewer` agent
   - `.dart` files → delegate to `riverpod-reviewer` agent
   - `.py` files with LangChain/LangGraph → delegate to `agentic-ai-reviewer` agent
   - `.py` files → delegate to `code-reviewer` agent
   - `.sql` files → delegate to `postgresql-database-reviewer` agent
   - Mixed/other → delegate to `code-reviewer` agent
3. **Always run** `security-reviewer` agent on the same scope
4. **Report findings** in this format:

```
## Review: [scope]

### Quality Issues
- [file:line] [severity] [description]

### Security Issues
- [file:line] [severity] [description]

### Summary
- Total issues: N (critical: X, warning: Y, info: Z)
- Status: ✅ PASS / ❌ FAIL
```

$ARGUMENTS
