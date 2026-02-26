# T-SQL Patterns

Production-ready T-SQL patterns for error handling, transactions, TVFs, MERGE, and isolation levels.

---

## Error Handling

### Standard TRY/CATCH Template

Always use `XACT_STATE()` before touching the transaction. `XACT_STATE() = -1` means the transaction is doomed — commit will fail.

```sql
BEGIN TRY
    BEGIN TRANSACTION;

    -- work here

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    -- THROW re-raises the original error number, severity, and message
    THROW;
END CATCH;
```

### Logging Before Re-Throw

When you need to log before surfacing the error:

```sql
BEGIN CATCH
    DECLARE @msg  NVARCHAR(4000) = ERROR_MESSAGE();
    DECLARE @sev  INT            = ERROR_SEVERITY();
    DECLARE @state INT           = ERROR_STATE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    INSERT INTO dbo.ErrorLog (ErrorMessage, ErrorSeverity, ErrorState, LoggedAt)
    VALUES (@msg, @sev, @state, SYSUTCDATETIME());

    THROW; -- preserve original error; do not use RAISERROR here
END CATCH;
```

### Why THROW over RAISERROR

| | THROW | RAISERROR |
|---|---|---|
| Preserves original error number | Yes | No (always 50000 unless WITH NOWAIT) |
| Simpler syntax | Yes | No |
| Re-raises catch block error | Yes | No |
| Status | Current standard | Legacy |

---

## Scalar UDF Anti-Pattern and Fix

Scalar UDFs disable parallelism and execute row-by-row. Replace with inline TVFs consumed via `CROSS APPLY`.

```sql
-- ❌ Scalar UDF — row-by-row, no parallelism
CREATE FUNCTION dbo.fnGetDisplayName(@UserId INT)
RETURNS NVARCHAR(200)
AS
BEGIN
    DECLARE @name NVARCHAR(200);
    SELECT @name = FirstName + ' ' + LastName FROM dbo.Users WHERE UserId = @UserId;
    RETURN @name;
END;

-- Called like:
SELECT dbo.fnGetDisplayName(UserId) FROM dbo.Orders; -- scans Users per row


-- ✅ Inline TVF — set-based, parallelism-eligible
CREATE FUNCTION dbo.fnGetDisplayNameInline(@UserId INT)
RETURNS TABLE
AS
RETURN
(
    SELECT FirstName + ' ' + LastName AS DisplayName
    FROM dbo.Users
    WHERE UserId = @UserId
);

-- Called via CROSS APPLY:
SELECT o.OrderId, u.DisplayName
FROM dbo.Orders o
CROSS APPLY dbo.fnGetDisplayNameInline(o.UserId) u;
```

---

## CTEs and Window Functions

### Paged Results with Window Functions

```sql
WITH Ranked AS
(
    SELECT
        OrderId,
        CustomerId,
        OrderDate,
        TotalAmount,
        ROW_NUMBER() OVER (ORDER BY OrderDate DESC) AS rn
    FROM dbo.Orders
    WHERE Status = 'Active'
)
SELECT OrderId, CustomerId, OrderDate, TotalAmount
FROM Ranked
WHERE rn BETWEEN 21 AND 40; -- page 2, 20 rows per page
```

### Running Total

```sql
SELECT
    OrderId,
    OrderDate,
    Amount,
    SUM(Amount) OVER (
        PARTITION BY CustomerId
        ORDER BY OrderDate
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS RunningTotal
FROM dbo.Orders;
```

---

## MERGE

Use MERGE for upsert operations. Always specify `HOLDLOCK` to prevent race conditions.

```sql
MERGE dbo.Products WITH (HOLDLOCK) AS tgt
USING (VALUES (@ProductId, @Name, @Price)) AS src (ProductId, Name, Price)
    ON tgt.ProductId = src.ProductId
WHEN MATCHED THEN
    UPDATE SET
        tgt.Name  = src.Name,
        tgt.Price = src.Price,
        tgt.UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN
    INSERT (ProductId, Name, Price, CreatedAt)
    VALUES (src.ProductId, src.Name, src.Price, SYSUTCDATETIME());
```

> **Warning:** MERGE has known edge cases with triggers and OUTPUT. Test thoroughly with concurrent workloads.

---

## Isolation Levels

### Comparison

| Level | Dirty Read | Non-Repeatable Read | Phantom Read | Blocking |
|-------|-----------|---------------------|--------------|---------|
| READ UNCOMMITTED | Yes | Yes | Yes | None |
| READ COMMITTED (default) | No | Yes | Yes | Moderate |
| READ COMMITTED SNAPSHOT (RCSI) | No | Yes | Yes | Low (optimistic) |
| REPEATABLE READ | No | No | Yes | High |
| SERIALIZABLE | No | No | No | Highest |
| SNAPSHOT | No | No | No | Low (optimistic) |

### Enabling RCSI (database-level, run once)

```sql
ALTER DATABASE YourDbName SET READ_COMMITTED_SNAPSHOT ON;
```

After enabling, all `READ COMMITTED` transactions use row versioning instead of shared locks — readers no longer block writers.

### When to Use Each Level

```
OLTP reads (SELECT without writes)      → READ COMMITTED (RCSI enabled)
Financial aggregations                  → SNAPSHOT or SERIALIZABLE
Reporting queries on live OLTP db       → SNAPSHOT isolation
Check-then-act patterns (insert if not) → SERIALIZABLE + retry on deadlock
Bulk import / ETL                       → READ UNCOMMITTED (NOLOCK) — acceptable for non-critical reads
```

---

## Deadlock Detection via XEvent Ring Buffer

```sql
SELECT
    xdr.value('@timestamp', 'datetime2')   AS deadlock_time,
    xdr.query('.')                          AS deadlock_graph_xml
FROM
(
    SELECT CAST(target_data AS XML) AS target_data
    FROM sys.dm_xe_session_targets  t
    JOIN sys.dm_xe_sessions          s ON s.address = t.event_session_address
    WHERE s.name   = 'system_health'
      AND t.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('//RingBufferTarget/event[@name="xml_deadlock_report"]') AS xdt(xdr)
ORDER BY deadlock_time DESC;
```

### Deadlock Remediation Checklist

1. Identify the two processes and their lock order from the XML graph.
2. Ensure both processes access tables in the same order.
3. Keep transactions as short as possible — avoid user interaction mid-transaction.
4. Use RCSI to eliminate reader-writer deadlocks.
5. Add `SET DEADLOCK_PRIORITY LOW` on the process that can safely retry.

---

## Parameter Sniffing

SQL Server compiles stored procedures with the first execution's parameter values. Skewed distributions cause bad plans on subsequent calls.

```sql
-- Option 1: Recompile per execution (high CPU on frequent calls)
CREATE PROCEDURE dbo.GetOrders @Status NVARCHAR(20)
AS
BEGIN
    SELECT OrderId, CustomerId, OrderDate
    FROM dbo.Orders
    WHERE Status = @Status
    OPTION (RECOMPILE);
END;

-- Option 2: Optimize for unknown (uses average statistics)
    OPTION (OPTIMIZE FOR (@Status UNKNOWN));

-- Option 3: Local variable copy (breaks sniffing; use with caution)
CREATE PROCEDURE dbo.GetOrders @Status NVARCHAR(20)
AS
BEGIN
    DECLARE @LocalStatus NVARCHAR(20) = @Status;
    SELECT OrderId, CustomerId, OrderDate
    FROM dbo.Orders
    WHERE Status = @LocalStatus;
END;
```

> Check Query Store first — force a known-good plan before adding hints.
