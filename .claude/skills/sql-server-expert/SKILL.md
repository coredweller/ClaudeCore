---
name: sql-server-expert
description: Expert in Microsoft SQL Server — T-SQL, execution plans, index tuning, and performance diagnostics.
argument-hint: "[query, schema, or performance problem to address]"
allowed-tools: Read
---

# SQL Server Expert

Diagnose, optimize, and write production-grade SQL Server T-SQL.

## Triggers

| Trigger | Example |
|---------|---------|
| `optimize query` | "optimize this slow query" |
| `execution plan` | "explain this execution plan" |
| `index strategy` | "index strategy for this table" |
| `deadlock` | "diagnose this deadlock" |
| `T-SQL` | "write a stored procedure for..." |
| `DMV` | "query to find top CPU queries" |
| `Query Store` | "check for plan regressions" |

## Quick Reference

| Task | Approach | Key File |
|------|----------|----------|
| Slow query | Check execution plan → stats → indexes | `reference/performance-diagnostics.md` |
| Index design | Workload type → DMV gaps → covering cols | `reference/index-strategy.md` |
| Error handling | TRY/CATCH + XACT_STATE + THROW | `reference/tsql-patterns.md` |
| Deadlock | XEvent ring buffer → graph → remediation | `reference/tsql-patterns.md` |
| Isolation level | Contention type → RCSI vs SERIALIZABLE | `reference/tsql-patterns.md` |
| Code review | Run full checklist | `reference/sql-server-review-checklist.md` |

## Process

### Phase 1: Diagnose

- Capture `SET STATISTICS IO, TIME ON` output and actual execution plan.
- Check sys.dm_exec_query_stats and sys.dm_db_missing_index_details.
- Review Query Store for plan regressions on the target query.

Read `reference/performance-diagnostics.md` for DMV queries and wait-stat analysis.

### Phase 2: Design / Write

- Choose index type based on workload — read `reference/index-strategy.md`.
- Apply T-SQL patterns for error handling, TVFs, and transaction management — read `reference/tsql-patterns.md`.
- Validate data types at join/filter boundaries to prevent implicit conversions.

### Phase 3: Verify

- Run through `reference/sql-server-review-checklist.md` before marking done.
- Re-run `SET STATISTICS IO, TIME ON` to confirm improvement.
- Check execution plan for elimination of key lookups and implicit conversions.

## Anti-Patterns

| Avoid | Why | Instead |
|-------|-----|---------|
| Scalar UDFs in SELECT/WHERE | Row-by-row execution, no parallelism | Inline TVF + CROSS APPLY |
| SELECT * in production | Schema drift, excess IO | Explicit column list |
| RAISERROR in new code | Deprecated; loses original error | THROW |
| Committing inside CATCH | May commit on doomed transaction | Check XACT_STATE() first |
| Implicit conversions at joins | Index scan forced, plan invalidated | Match data types explicitly |
| Cursor for set-based work | Row-by-row; orders of magnitude slower | Set-based query or window function |
| Heap tables on large datasets | RID lookups, no sort order | Always define a clustered index |
| Statistics left stale | Bad cardinality estimates, wrong plans | UPDATE STATISTICS or auto-update |

## Commands

| Command | When to Use |
|---------|-------------|
| `diagnose query {query}` | Slow query — full plan + stats analysis |
| `index {table}` | Missing indexes — DMV-based recommendation |
| `deadlock analysis` | Deadlock trace — XEvent graph interpretation |
| `write proc {spec}` | New stored procedure — with TRY/CATCH template |
| `review` | Code review — run full checklist |

## Reference Files

| File | Contents |
|------|----------|
| `reference/tsql-patterns.md` | Error handling, TVFs, MERGE, transactions, isolation levels, deadlock detection |
| `reference/index-strategy.md` | Index types, covering indexes, filtered/columnstore, maintenance |
| `reference/performance-diagnostics.md` | DMV queries, wait stats, Query Store, tempdb, plan cache |
| `reference/sql-server-review-checklist.md` | Pre-submit review checklist for T-SQL and schema changes |
