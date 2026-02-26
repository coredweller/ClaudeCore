# SQL Server Index Strategy

Design and maintain SQL Server indexes for optimal read/write balance.

---

## Index Types

| Type | Best For | Notes |
|------|----------|-------|
| Clustered | Primary access path; defines physical row order | One per table; default on PK |
| Non-clustered | Secondary lookups and covering indexes | Up to 999 per table |
| Filtered | Partial table subsets (e.g., active rows only) | Smaller, faster for selective queries |
| Columnstore (clustered) | OLAP / data warehouse | Compress columns; excellent for aggregations |
| Columnstore (non-clustered) | Mixed OLTP/OLAP on same table | Updateable; covers analytics without a heap |
| Full-text | Natural language search | Separate full-text catalog required |
| Spatial | Geography/geometry columns | GIS workloads |

---

## Always Index

| Column Category | Reason |
|-----------------|--------|
| Foreign keys | Speed up JOINs; prevent table scans on child table |
| WHERE clause columns (high selectivity) | Filter early, reduce rows processed |
| ORDER BY / GROUP BY columns | Eliminate sort operators in plan |
| JOIN ON columns (non-FK side) | Support merge/hash join strategies |

---

## Covering Indexes

A covering index includes all columns a query needs, eliminating a Key Lookup (bookmark lookup) back to the clustered index.

```sql
-- Query needing cover:
SELECT OrderDate, TotalAmount
FROM dbo.Orders
WHERE CustomerId = 42 AND Status = 'Active';

-- Covering index: filter columns first, then INCLUDE the SELECT columns
CREATE NONCLUSTERED INDEX ix_orders_customer_status
    ON dbo.Orders (CustomerId, Status)
    INCLUDE (OrderDate, TotalAmount);
```

**Rule of thumb:** Leading columns = WHERE/JOIN predicates (most selective first). INCLUDE columns = remaining SELECT-list columns.

---

## Filtered Indexes

Useful for queries that always filter on a known subset. Smaller index → faster scans.

```sql
-- Only index active orders (e.g., 5% of table)
CREATE NONCLUSTERED INDEX ix_orders_active
    ON dbo.Orders (OrderDate, CustomerId)
    INCLUDE (TotalAmount)
    WHERE Status = 'Active';

-- Only index non-null optional fields
CREATE NONCLUSTERED INDEX ix_users_email
    ON dbo.Users (Email)
    WHERE Email IS NOT NULL;
```

> Queries must include the filter predicate in the WHERE clause for the optimizer to choose the filtered index.

---

## Columnstore Indexes

Best for aggregation-heavy queries on large tables.

```sql
-- Clustered columnstore (replaces row store — OLAP tables)
CREATE CLUSTERED COLUMNSTORE INDEX cci_Sales ON dbo.FactSales;

-- Non-clustered columnstore on OLTP table (mixed workload)
CREATE NONCLUSTERED COLUMNSTORE INDEX ncci_orders_analytics
    ON dbo.Orders (OrderDate, CustomerId, Status, TotalAmount);
```

**Columnstore characteristics:**
- Column-based compression: 5–10x storage reduction typical.
- Batch execution mode: processes 900 rows at a time — massive CPU savings on aggregations.
- Delta stores: small inserts stage in row format before compressing into segments.
- `ALTER INDEX ... REORGANIZE` merges delta stores; `REBUILD` recompresses segments.

---

## DMV-Based Missing Index Analysis

Run before creating any new index — the optimizer tracks gaps during query execution.

```sql
SELECT TOP 20
    ROUND(
        migs.avg_total_user_cost
        * migs.avg_user_impact
        * (migs.user_seeks + migs.user_scans),
        0
    )                           AS score,
    mid.statement               AS table_name,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    migs.user_seeks,
    migs.user_scans,
    migs.last_user_seek
FROM sys.dm_db_missing_index_group_stats  migs
JOIN sys.dm_db_missing_index_groups       mig  ON migs.group_handle = mig.index_group_handle
JOIN sys.dm_db_missing_index_details      mid  ON mig.index_handle  = mid.index_handle
ORDER BY score DESC;
```

> Scores are cumulative since the last SQL Server restart. High scores indicate frequently needed indexes, but validate against actual query workload before creating.

---

## Unused Index Detection

Unused indexes consume write overhead on every INSERT/UPDATE/DELETE.

```sql
SELECT
    OBJECT_NAME(i.object_id)        AS table_name,
    i.name                          AS index_name,
    i.type_desc,
    ius.user_seeks,
    ius.user_scans,
    ius.user_lookups,
    ius.user_updates,
    ius.last_user_seek,
    ius.last_user_scan
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats ius
    ON i.object_id  = ius.object_id
    AND i.index_id  = ius.index_id
    AND ius.database_id = DB_ID()
WHERE i.type_desc <> 'HEAP'
  AND i.is_primary_key = 0
  AND i.is_unique = 0
  AND (ius.user_seeks  IS NULL OR ius.user_seeks  = 0)
  AND (ius.user_scans  IS NULL OR ius.user_scans  = 0)
  AND (ius.user_lookups IS NULL OR ius.user_lookups = 0)
ORDER BY ius.user_updates DESC NULLS LAST;
```

> Stats reset on SQL Server restart. Only act on indexes with zero reads after a full representative workload period (days/weeks).

---

## Index Fragmentation and Maintenance

```sql
-- Check fragmentation
SELECT
    OBJECT_NAME(ips.object_id)  AS table_name,
    i.name                       AS index_name,
    ips.index_type_desc,
    ips.avg_fragmentation_in_percent,
    ips.page_count
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 5
ORDER BY ips.avg_fragmentation_in_percent DESC;
```

### Maintenance Decision

| Fragmentation | Action |
|--------------|--------|
| < 5% | No action |
| 5–30% | `ALTER INDEX ... REORGANIZE` (online, minimal locks) |
| > 30% | `ALTER INDEX ... REBUILD` (offline by default; use `WITH (ONLINE = ON)` for Enterprise) |

```sql
-- Online rebuild (Enterprise only)
ALTER INDEX ix_orders_customer_status ON dbo.Orders
REBUILD WITH (ONLINE = ON, FILLFACTOR = 80);

-- Reorganize (always online)
ALTER INDEX ix_orders_customer_status ON dbo.Orders REORGANIZE;
```

---

## Column Order Rules

1. **Equality predicates first** — columns used with `=` in WHERE.
2. **Range predicates second** — columns used with `>`, `<`, `BETWEEN`, `LIKE`.
3. **Most selective columns** within each category go first.
4. **INCLUDE** columns satisfy SELECT without being in the key — no order needed.

```
WHERE CustomerId = @id      -- equality → position 1
  AND OrderDate > @start    -- range   → position 2
  AND Status = @status      -- equality but lower cardinality → position 3
```

Composite key: `(CustomerId, Status, OrderDate)` — or swap Status and OrderDate based on actual selectivity measurements.
