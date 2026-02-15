---
name: database-schema-designer
description: This skill should be used when designing database schemas for SQL or NoSQL databases. It provides normalization guidelines, indexing strategies, migration patterns, and performance optimization.
argument-hint: "[domain or requirements]"
allowed-tools: Read
---

# Database Schema Designer

Design production-ready database schemas with best practices built-in.

## Triggers

| Trigger | Example |
|---------|---------|
| `design schema` | "design a schema for user authentication" |
| `database design` | "database design for multi-tenant SaaS" |
| `create tables` | "create tables for a blog system" |
| `schema for` | "schema for inventory management" |
| `model data` | "model data for real-time analytics" |
| `I need a database` | "I need a database for tracking orders" |
| `design NoSQL` | "design NoSQL schema for product catalog" |

## Quick Reference

| Task | Approach | Key Consideration |
|------|----------|-------------------|
| New schema | Normalize to 3NF first | Domain modeling over UI |
| SQL vs NoSQL | Access patterns decide | Read/write ratio matters |
| Primary keys | INT or UUID | UUID for distributed systems |
| Foreign keys | Always constrain | ON DELETE strategy critical |
| Indexes | FKs + WHERE columns | Column order matters |
| Migrations | Always reversible | Backward compatible first |

## Process

### Phase 1: Analyze

- Identify entities and relationships
- Determine access patterns (read-heavy vs write-heavy)
- Choose SQL or NoSQL based on requirements

### Phase 2: Design

- Normalize to 3NF (SQL) or determine embed/reference strategy (NoSQL)
- Define primary keys and foreign keys
- Choose appropriate data types -- read `reference/data-types-reference.md` for type guides
- Add constraints -- read `reference/constraints-and-relationships.md` for patterns

Read `reference/normalization-guide.md` for 1NF/2NF/3NF rules and examples.

### Phase 3: Optimize

- Plan indexing strategy -- read `reference/indexing-strategy.md` for when to index and composite index rules
- Consider denormalization for read-heavy queries
- Add timestamps (created_at, updated_at)

### Phase 4: Migrate

- Generate migration scripts (up + down)
- Ensure backward compatibility
- Plan zero-downtime deployment

Read `reference/migration-patterns.md` for zero-downtime patterns and rollback strategies.

### NoSQL Design

For MongoDB, Firestore, and other document databases, read `reference/nosql-design-patterns.md` for embedding vs referencing patterns and Firestore-specific design rules.

## Commands

| Command | When to Use |
|---------|-------------|
| `design schema for {domain}` | Start fresh -- full schema generation |
| `normalize {table}` | Fix existing table -- apply normalization rules |
| `add indexes for {table}` | Performance issues -- generate index strategy |
| `migration for {change}` | Schema evolution -- create reversible migration |
| `review schema` | Code review -- audit existing schema |

## Anti-Patterns

| Avoid | Why | Instead |
|-------|-----|---------|
| VARCHAR(255) everywhere | Wastes storage, hides intent | Size appropriately per field |
| FLOAT for money | Rounding errors | DECIMAL(10,2) |
| Missing FK constraints | Orphaned data | Always define foreign keys |
| No indexes on FKs | Slow JOINs | Index every foreign key |
| Storing dates as strings | Cannot compare/sort | DATE, TIMESTAMP types |
| Non-reversible migrations | Cannot rollback | Always write DOWN migration |

## Verification

After designing a schema, run through `reference/schema-design-checklist.md` to verify completeness.

## Documentation Sources

Before generating schemas or queries, consult these sources:

| Source | URL / Tool | Purpose |
|--------|-----------|---------|
| PostgreSQL | `PostgreSQL MCP server` | Schema-aware SQL, introspection, admin-safe workflows |
| Firebase Firestore | `Firebase MCP server` | Document design, rules, indexes for NoSQL schemas |

## Reference Files

| File | Contents |
|------|----------|
| `reference/schema-design-checklist.md` | Pre-design, table design, and deployment checklist |
| `reference/normalization-guide.md` | 1NF/2NF/3NF explanations, examples, denormalization guide |
| `reference/data-types-reference.md` | String, numeric, date/time, JSON type guides |
| `reference/indexing-strategy.md` | When to index, composite indexes, B-tree vs hash, EXPLAIN |
| `reference/constraints-and-relationships.md` | PKs, FKs, CHECK, UNIQUE, relationship patterns |
| `reference/nosql-design-patterns.md` | MongoDB/Firestore embedding vs referencing |
| `reference/migration-patterns.md` | Zero-downtime migrations, rollback strategies |
| `assets/templates/migration-template.sql` | SQL migration file template |
| `reference/postgresql-review-checklist.md` | PostgreSQL review checklist (used by `postgresql-database-reviewer` agent) |

## Error Handling

**Migration conflicts**: When migrations fail, check for column type mismatches or missing dependent migrations. Never modify an applied migration — create a new corrective one.

**Index creation failures**: Verify the column exists and data types support the index type. For large tables, use `CREATE INDEX CONCURRENTLY`.
