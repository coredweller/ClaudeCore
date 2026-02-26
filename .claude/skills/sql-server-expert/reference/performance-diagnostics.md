# SQL Server Performance Diagnostics

DMV queries, wait stats, Query Store, plan cache, and tempdb analysis.

---

## Top CPU Queries

```sql
SELECT TOP 20
    qs.total_worker_time / qs.execution_count  AS avg_cpu_us,
    qs.total_worker_time                        AS total_cpu_us,
    qs.execution_count,
    qs.total_elapsed_time / qs.execution_count  AS avg_elapsed_us,
    SUBSTRING(
        qt.text,
        qs.statement_start_offset / 2 + 1,
        (CASE WHEN qs.statement_end_offset = -1
              THEN LEN(CONVERT(NVARCHAR(MAX), qt.text)) * 2
              ELSE qs.statement_end_offset
         END - qs.statement_start_offset) / 2 + 1
    )                                           AS query_text,
    qp.query_plan
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle)  qt
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
ORDER BY avg_cpu_us DESC;
```

---

## Top IO Queries

```sql
SELECT TOP 20
    (qs.total_logical_reads + qs.total_logical_writes) / qs.execution_count AS avg_io,
    qs.total_logical_reads  / qs.execution_count                             AS avg_reads,
    qs.total_logical_writes / qs.execution_count                             AS avg_writes,
    qs.execution_count,
    SUBSTRING(qt.text,
        qs.statement_start_offset / 2 + 1,
        (CASE WHEN qs.statement_end_offset = -1
              THEN LEN(CONVERT(NVARCHAR(MAX), qt.text)) * 2
              ELSE qs.statement_end_offset
         END - qs.statement_start_offset) / 2 + 1)                          AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
ORDER BY avg_io DESC;
```

---

## Wait Statistics

Current waits since last SQL Server restart — highest impact first.

```sql
SELECT TOP 20
    wait_type,
    wait_time_ms / 1000.0                            AS wait_time_sec,
    (wait_time_ms - signal_wait_time_ms) / 1000.0   AS resource_wait_sec,
    signal_wait_time_ms / 1000.0                     AS signal_wait_sec,
    waiting_tasks_count,
    CAST(100.0 * wait_time_ms / SUM(wait_time_ms) OVER () AS DECIMAL(5,2)) AS pct_total
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    -- Benign background waits — exclude from analysis
    'SLEEP_TASK','BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_AUTO_EVENT',
    'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT',
    'HADR_FILESTREAM_IOMGR_IOCOMPLETION','HADR_WORK_QUEUE',
    'LAZYWRITER_SLEEP','LOGMGR_QUEUE','ONDEMAND_TASK_QUEUE',
    'REQUEST_FOR_DEADLOCK_SEARCH','RESOURCE_QUEUE','SERVER_IDLE_CHECK',
    'SLEEP_DBSTARTUP','SLEEP_DCOMSTARTUP','SLEEP_MASTERDBREADY',
    'SLEEP_MASTERMDREADY','SLEEP_MASTERUPGRADED','SLEEP_MSDBSTARTUP',
    'SLEEP_TEMPDBSTARTUP','SNI_HTTP_ACCEPT','SP_SERVER_DIAGNOSTICS_SLEEP',
    'SQLAGENT_ALERT_ALERT_WAIT','SQLAGENT_NOTIFY_STARTUP',
    'WAITFOR','XE_DISPATCHER_WAIT','XE_TIMER_EVENT','SQLTRACE_BUFFER_FLUSH'
)
ORDER BY wait_time_ms DESC;
```

### Common Wait Types and Remediation

| Wait Type | Indicates | Action |
|-----------|-----------|--------|
| CXPACKET / CXCONSUMER | Parallelism skew | Check MAXDOP; look for skewed distributions |
| LCK_M_* | Lock contention | Isolate blocking queries; consider RCSI |
| PAGEIOLATCH_SH/EX | IO bottleneck or missing indexes | Check disk latency; add covering indexes |
| WRITELOG | Log IO bottleneck | Move log to faster storage; check VLF count |
| SOS_SCHEDULER_YIELD | CPU pressure | Identify top CPU queries; tune or scale |
| ASYNC_NETWORK_IO | Client not reading results fast enough | Reduce result set; check network |
| RESOURCE_SEMAPHORE | Memory grant waits | Fix spills; tune max server memory |
| TEMPDB_THROTTLED_REQUESTS | Tempdb allocation contention | Add tempdb data files to match CPU count |

---

## Query Store

### Enable Query Store

```sql
ALTER DATABASE YourDbName SET QUERY_STORE = ON
(
    OPERATION_MODE = READ_WRITE,
    CLEANUP_POLICY = (STALE_QUERY_THRESHOLD_DAYS = 30),
    DATA_FLUSH_INTERVAL_SECONDS = 900,
    MAX_STORAGE_SIZE_MB = 1024,
    QUERY_CAPTURE_MODE = AUTO
);
```

### Find Regressed Queries (Last 24 Hours)

```sql
SELECT TOP 20
    qt.query_sql_text,
    rs.avg_duration         AS recent_avg_duration_us,
    rsh.avg_duration        AS hist_avg_duration_us,
    rs.avg_duration - rsh.avg_duration AS regression_us,
    p.plan_id               AS recent_plan_id,
    ph.plan_id              AS hist_plan_id
FROM sys.query_store_query         q
JOIN sys.query_store_query_text    qt  ON q.query_text_id  = qt.query_text_id
JOIN sys.query_store_plan          p   ON q.query_id       = p.query_id
JOIN sys.query_store_runtime_stats rs  ON p.plan_id        = rs.plan_id
JOIN sys.query_store_runtime_stats_interval ri
    ON rs.runtime_stats_interval_id = ri.runtime_stats_interval_id
-- Historical stats (prior interval)
JOIN sys.query_store_plan          ph  ON q.query_id       = ph.query_id
JOIN sys.query_store_runtime_stats rsh ON ph.plan_id       = rsh.plan_id
WHERE ri.start_time > DATEADD(HOUR, -24, SYSUTCDATETIME())
  AND rs.avg_duration > rsh.avg_duration * 1.5  -- 50% regression threshold
ORDER BY regression_us DESC;
```

### Force a Plan

```sql
-- Find query_id and plan_id from Query Store views above, then:
EXEC sys.sp_query_store_force_plan @query_id = 42, @plan_id = 7;

-- Unforce:
EXEC sys.sp_query_store_unforce_plan @query_id = 42, @plan_id = 7;
```

---

## Plan Cache Analysis

### Large or Frequently Invalidated Plans

```sql
SELECT TOP 20
    cp.usecounts,
    cp.size_in_bytes / 1024     AS size_kb,
    cp.cacheobjtype,
    qt.text
FROM sys.dm_exec_cached_plans cp
CROSS APPLY sys.dm_exec_sql_text(cp.plan_handle) qt
WHERE cp.objtype IN ('Adhoc', 'Prepared')
ORDER BY cp.size_in_bytes DESC;
```

### Plan Cache Bloat from Ad-hoc Queries

Excessive single-use plans indicate parameterization issues.

```sql
SELECT
    SUM(CASE WHEN usecounts = 1 THEN size_in_bytes ELSE 0 END) / 1024 / 1024 AS single_use_mb,
    SUM(size_in_bytes) / 1024 / 1024                                           AS total_cache_mb
FROM sys.dm_exec_cached_plans;
```

Fix: enable Optimize for Ad-hoc Workloads (stores a stub on first execution):

```sql
EXEC sp_configure 'optimize for ad hoc workloads', 1;
RECONFIGURE;
```

---

## Tempdb Diagnostics

### Version Store Size (RCSI / Snapshot workloads)

```sql
SELECT
    SUM(version_store_reserved_page_count) * 8 / 1024 AS version_store_mb
FROM sys.dm_db_file_space_usage
WHERE database_id = 2; -- tempdb
```

### Allocation Page Contention

Symptom: `2:1:1`, `2:1:3` latch waits. Fix: set tempdb data files = number of logical CPU cores (cap at 8).

```sql
-- Check current tempdb file count
SELECT COUNT(*) AS data_file_count
FROM sys.master_files
WHERE database_id = 2 AND type = 0;
```

### Active Tempdb Usage by Session

```sql
SELECT
    s.session_id,
    s.login_name,
    s.host_name,
    tdb.user_objects_alloc_page_count   * 8 AS user_obj_kb,
    tdb.internal_objects_alloc_page_count * 8 AS internal_obj_kb,
    r.total_elapsed_time / 1000             AS elapsed_ms,
    r.status,
    SUBSTRING(qt.text, r.statement_start_offset / 2 + 1, 200) AS query_snippet
FROM sys.dm_db_session_space_usage tdb
JOIN sys.dm_exec_sessions s ON tdb.session_id = s.session_id
LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) qt
WHERE (tdb.user_objects_alloc_page_count + tdb.internal_objects_alloc_page_count) > 100
ORDER BY (tdb.user_objects_alloc_page_count + tdb.internal_objects_alloc_page_count) DESC;
```

---

## Memory Diagnostics

### Buffer Pool Usage by Database

```sql
SELECT
    DB_NAME(database_id)            AS db_name,
    COUNT(*) * 8 / 1024             AS buffer_pool_mb
FROM sys.dm_os_buffer_descriptors
GROUP BY database_id
ORDER BY buffer_pool_mb DESC;
```

### Memory Grants and Spills

Spills to tempdb indicate insufficient memory grants — often caused by stale statistics or bad estimates.

```sql
SELECT TOP 10
    qs.execution_count,
    qs.total_spills / qs.execution_count  AS avg_spills,
    qs.total_spills,
    SUBSTRING(qt.text, qs.statement_start_offset / 2 + 1, 200) AS query_snippet
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
WHERE qs.total_spills > 0
ORDER BY avg_spills DESC;
```
