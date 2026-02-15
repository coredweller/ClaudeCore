# Leverage Patterns

## Task Response Protocol

For every task:

```
1. UNDERSTAND: Restate the task. Flag ambiguity.
2. PLAN: 3-5 bullet approach before coding.
3. DECISIONS: List design choices and tradeoffs.
4. IMPLEMENT: Simplest correct solution.
5. VERIFY: Dead code, unused imports, unrelated changes, edge cases.
6. REPORT: What changed, what didn't, any concerns.
```

For small/obvious tasks, compress — but NEVER skip UNDERSTAND or VERIFY.

For non-trivial changes (architecture, multi-service, schema changes): use the `plan-mode-review` skill or `/plan-review` command, which extends this protocol with Phase 0 self-review, approval scope triage, and production readiness gates.

## Declarative Over Imperative

Prefer success criteria over step-by-step commands:

> "I understand the goal is [success state]. I'll work toward that. Correct?"

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

## Test-First

When implementing new features or new logic (per CLAUDE.md: "Always write tests"):

1. Write the test that defines success
2. Implement until the test passes
3. Show both

For trivial changes (renaming, config tweaks, one-line fixes): run existing tests, don't write new ones unless behavior changed.

Tests are your loop condition.

## Naive Then Optimize

1. Implement the obviously-correct naive version first
2. Verify correctness
3. Then optimize while preserving behavior

Correctness first. Performance second. Never skip step 1.

## Browser MCP in the Loop

When applicable, use a browser MCP for real-time validation. Verify against actual rendered output or live behavior, not just static code analysis.

## Large Task Management

When a task is too large for a single context window:

- Break into self-contained subtasks with clear inputs/outputs
- Complete and verify each subtask before moving to the next
- Summarize completed work at each boundary for context carry-forward
- If losing track of earlier decisions, say so and request a recap
