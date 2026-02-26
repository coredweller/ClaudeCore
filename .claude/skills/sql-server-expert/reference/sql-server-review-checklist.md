# SQL Server Review Checklist

Run this checklist before marking any T-SQL or schema change done.

---

## Query Quality

- [ ] No `SELECT *` — explicit column list only.
- [ ] All JOINs have matching data types on both sides (no implicit conversions).
- [ ] `NULL` handling is explicit — `IS NULL` / `IS NOT NULL`, `ISNULL()` or `COALESCE()` where needed.
- [ ] No scalar UDFs in `SELECT` lists or `WHERE` clauses on large tables — use inline TVFs + `CROSS APPLY`.
- [ ] Set-based logic used instead of cursors/loops wherever possible.
- [ ] `TOP` or `WHERE` clause present on all `UPDATE`/`DELETE` statements that are not intended to touch the full table.
- [ ] No dynamic SQL without parameterization (`sp_executesql` with typed parameters, not string concatenation).

---

## Performance

- [ ] Actual execution plan reviewed — no unexpected Key Lookups, RID Lookups, or Table Scans.
- [ ] `SET STATISTICS IO, TIME ON` output checked and baseline documented.
- [ ] No implicit conversions on filter or join columns (check for yellow bang warnings in plan).
- [ ] Parameter sniffing risk assessed — `OPTION (RECOMPILE)` or `OPTIMIZE FOR` applied and documented if required.
- [ ] Query Store consulted for existing plan regressions before adding hints.
- [ ] Tempdb usage checked — no unexpected sort/spool operators consuming large grants.
- [ ] Statistics freshness verified (`DBCC SHOW_STATISTICS`) if bad plan is suspected.

---

## Indexes

- [ ] All foreign key columns have a supporting non-clustered index.
- [ ] New queries checked against `sys.dm_db_missing_index_details` for recommended indexes.
- [ ] Existing index usage validated via `sys.dm_db_index_usage_stats` — no newly redundant indexes left behind.
- [ ] Covering indexes include only the columns needed (no over-wide INCLUDE lists).
- [ ] Filtered indexes include the filter predicate in corresponding queries.
- [ ] Column order in composite indexes: equality predicates first, range predicates last.

---

## Error Handling and Transactions

- [ ] Every `BEGIN TRANSACTION` has a matching `COMMIT` and `ROLLBACK` path.
- [ ] All `CATCH` blocks check `XACT_STATE()` before rolling back.
- [ ] `THROW` used instead of `RAISERROR` in new code.
- [ ] No commit inside a `CATCH` block.
- [ ] Isolation level explicitly set and documented for each transaction context.
- [ ] Deadlock retry logic present where `SERIALIZABLE` isolation or high-contention patterns are used.

---

## Schema Changes

- [ ] Migration script includes both UP and DOWN (rollback) statements.
- [ ] Non-nullable column additions include a default value for existing rows.
- [ ] Large-table index creation uses `WITH (ONLINE = ON)` (Enterprise) or scheduled during low-traffic window.
- [ ] Foreign key constraints added with `WITH NOCHECK` on existing data where full backfill is deferred — and re-enabled explicitly.
- [ ] Data type changes verified for implicit conversion impact on all dependent queries and indexes.
- [ ] Deprecated column/table drops confirmed unused across all applications and jobs before removal.

---

## Security

- [ ] No dynamic SQL built from unparameterized user input (SQL injection risk).
- [ ] Stored procedures execute under principle of least privilege — no `EXECUTE AS OWNER` unless required.
- [ ] Sensitive columns (PII, credentials) not logged or exposed in error messages.
- [ ] Row-level security or view-based access control in place for multi-tenant data.
- [ ] `DENY` explicit permissions reviewed — not relying solely on role membership for sensitive tables.

---

## Stored Procedures and Functions

- [ ] `SET NOCOUNT ON` at the top of every stored procedure (suppresses rowcount noise for ORM compatibility).
- [ ] Output parameters or result sets — not both, to avoid ambiguous caller contracts.
- [ ] Inline TVFs preferred over multi-statement TVFs and scalar UDFs.
- [ ] Procedures do not reference objects in other databases by three-part name unless cross-database access is a documented requirement.
- [ ] `WITH RECOMPILE` or `OPTION (RECOMPILE)` documented with rationale if used.

---

## Maintenance and Observability

- [ ] Long-running queries have a timeout or `WAITFOR` guard to prevent indefinite blocking.
- [ ] Batch jobs use `SET ROWCOUNT` or chunked deletes/updates to avoid long-running transactions.
- [ ] SQL Server Agent job steps include `ON FAILURE: Notify Operator` action.
- [ ] New tables include `CreatedAt DATETIME2 DEFAULT SYSUTCDATETIME()` and `UpdatedAt` columns.
- [ ] Archival / purge strategy defined for high-volume tables.
