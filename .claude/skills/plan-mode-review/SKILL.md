---
name: plan-mode-review
description: Structured plan review with Phase 0 self-review, 5-phase code review (Architecture, Code Quality, Tests, Performance, Production Readiness), approval scope triage, decision logging, and blast radius assessment. Use when reviewing plans, PRs, or preparing non-trivial changes for implementation.
---

# Plan Mode Review

Structured review workflow for non-trivial changes. Covers planning discipline (Phase 0) and 5-phase technical review with severity triage, decision logging, and production readiness gates.

## Modes

Ask the user which mode to use:

| Mode | When | Phases |
|------|------|--------|
| **Big Change** | New features, architectural changes, multi-service work | Phase 0 + all 5 review sections (up to 4 issues each) |
| **Small Change** | Focused feature, single-service change | Phase 0 + top issue per section only |
| **Review Only** | PR review, existing code audit, refactor | Skip Phase 0 (lightweight outcome check only) + all 5 review sections |

## Reference Files

Load references as needed per phase:

| Phase | Reference File | Contents |
|-------|---------------|----------|
| Core | [reference/plan-mode-protocol.md](reference/plan-mode-protocol.md) | Approval scope triage, severity classification, Phase 0 gate requirements, multi-turn continuity, token limit triage |
| Phase 0 | [reference/phase0-self-review.md](reference/phase0-self-review.md) | Outcome spec, 3 approaches, self-critique, deletion pass, gate check |
| Phase 5 | [reference/production-readiness-gate.md](reference/production-readiness-gate.md) | Blast radius, rollback strategy, dependency health, cost/infra impact, data migration, second-order effects |
| All phases | [reference/review-interaction-protocol.md](reference/review-interaction-protocol.md) | Question format, decision log, visualization requirements, section pause protocol |

## Process

### Phase 0: Self-Review Loop (Big Change / Small Change only)

1. Read [reference/plan-mode-protocol.md](reference/plan-mode-protocol.md) for approval scope and severity rules
2. Read [reference/phase0-self-review.md](reference/phase0-self-review.md)
3. Execute Steps 0.1 through 0.5 in order
4. Do NOT proceed to Phase 1 until Phase 0 gate passes

For **Review Only** mode: skip Phase 0 but run a lightweight outcome check — ask "Is this still the right thing to build/maintain? Has the original goal changed?"

### Phase 1: Architecture Review

Read [reference/review-interaction-protocol.md](reference/review-interaction-protocol.md) for visualization and question format requirements.

Evaluate:
- System design and component boundaries
- Dependency graph and coupling
- Data flow patterns and bottlenecks
- Scaling characteristics and single points of failure
- Security architecture (auth, data access, API boundaries)

Generate a Mermaid or ASCII diagram of the current architecture BEFORE discussing issues.

### Phase 2: Code Quality Review

Evaluate:
- Code organization and module structure
- DRY violations (be aggressive — per `code-standards.md`)
- Error handling patterns and missing edge cases
- Technical debt hotspots
- Over-engineering vs under-engineering

For deep review, delegate to the `code-reviewer` agent with its checklist.

### Phase 3: Test Review

Evaluate:
- Coverage gaps (unit, integration, e2e)
- Assertion quality — strong assertions > high coverage percentage
- Missing edge case coverage
- Untested failure modes and error paths

### Phase 4: Performance Review

Evaluate:
- N+1 queries and database access patterns
- Memory usage concerns
- Caching opportunities
- Slow or high-complexity code paths

Generate an annotated request/data flow diagram showing timing or complexity.

### Phase 5: Production Readiness Review

1. Read [reference/production-readiness-gate.md](reference/production-readiness-gate.md)
2. Execute all subsections: blast radius, rollback, dependency health, second-order effects, cost/infra, data migration
3. Verify the production readiness gate checklist before approving

## Cross-Skill Delegation

| Need | Delegate to |
|------|-------------|
| Architecture Decision Records | `architecture-decision-records` skill |
| Deep security audit | `security-reviewer` agent |
| Database migration patterns | `database-schema-designer` skill |
| Code review checklist | `code-reviewer` agent |
| Tech debt / duplication | `dedup-code-agent` agent |

## Error Handling

**No plan provided:** Ask the user to describe the change, paste the plan, or point to a PR/branch.

**Scope unclear:** Ask which mode (Big Change / Small Change / Review Only) and which phases to include.

**Phase 0 gate fails:** List which gate items are incomplete. Do NOT proceed — ask the user to resolve.

**Cannot verify a claim:** Mark as `[UNVERIFIED — needs manual check]` with the specific command or URL to verify. Never fabricate evidence.
