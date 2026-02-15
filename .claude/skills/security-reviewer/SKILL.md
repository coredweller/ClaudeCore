---
name: security-reviewer
description: Security vulnerability detection and remediation skill. Provides OWASP Top 10 checklists, secret scanning patterns, and security review methodology.
allowed-tools: Read, Bash, Grep, Glob
---

# Security Review Skill

## Purpose

Provides security review methodology, vulnerability checklists, and remediation patterns for application code.

## Process

1. **Load checklist** -- Read the security review checklist for review categories and severity levels
2. **Scan code** -- Use Grep/Glob to find security-sensitive patterns
3. **Evaluate** -- Check each finding against the checklist
4. **Report** -- Output findings with severity and remediation guidance

For the complete security review checklist and methodology:

Read [reference/security-review-checklist.md](reference/security-review-checklist.md)

## Error Handling

If target files/directories don't exist, report "Target not found" with the paths searched.
If a scan produces no findings, report "No security issues detected" with scope of scan.
