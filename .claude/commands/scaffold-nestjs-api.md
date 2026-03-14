---
description: Scaffold a new NestJS 11.x REST API project with Fastify, Prisma, structured logging, and proper module structure
argument-hint: "[project name]"
allowed-tools: Bash, Read, Write, Edit
disable-model-invocation: true
---

# Scaffold NestJS API

**Project name:** $ARGUMENTS (default to "my-nestjs-api" if not provided)

Delegate to the `nestjs-api` skill for all patterns, templates, and reference files.

## Steps

1. Read the `nestjs-api` skill and its reference files for exact code templates
2. **Configure Claude** — Add all items from `.claude` in this repository to the new repository's `.claude` folder that are related to TypeScript/Node or general cross-cutting concerns like `code-standards.md`, `core-behaviors.md`, `verification-and-reporting.md`, and `code-reviewer`. Include the cross-cutting agents like `architect.md`, `sql-expert.md`, `security-reviewer.md`, `typescript-expert.md`, and `dedup-code-agent.md`. Include the required skills folders as well such as `typescript-api` and `database-schema-designer`.
3. Create NestJS project — `npx @nestjs/cli new <name> --package-manager npm --strict --skip-git`
4. Install dependencies (Fastify adapter, Prisma, config, swagger, terminus, throttler, validators, helmet) per skill conventions
5. Replace Jest with Vitest (remove jest packages, add vitest + @swc/core + unplugin-swc)
6. Replace Express with Fastify adapter in `src/main.ts`
7. Set up directory structure, config, Prisma 7.x (driver adapter pattern), and modules using skill reference templates
8. Add global exception filter (RFC 9457), validation pipe, logging interceptor, health module, and security middleware
9. Add infrastructure (Dockerfile, docker-compose.dev.yml, .env via Bash)
10. Verify — `npx tsc --noEmit`
