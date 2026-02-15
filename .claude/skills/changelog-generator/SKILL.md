---
name: changelog-generator
description: This skill should be used when preparing releases, writing app store updates, or maintaining a CHANGELOG.md. It parses conventional commits and outputs polished release notes.
allowed-tools: Bash, Read, Write, Edit
---

# Changelog Generator Skill

Transform git commit history into polished, user-friendly changelogs. Works with any tech stack by auto-detecting the project structure.

## High-Level Process

1. **Detect project structure** - Scan repo for platform markers (Java, Node, Python, Angular, Flutter, etc.) and build a platform label map
2. **Determine commit range** - Use tags, dates, or commit count. Ask user if unclear
3. **Extract commits** - Pull structured log: `git log "$LAST_TAG"..HEAD --pretty=format:"%h|%ai|%an|%s" --no-merges`
4. **Categorize** - Map conventional commit prefixes to user-facing categories (feat -> New Features, fix -> Bug Fixes, perf -> Performance). Skip refactor/test/chore/ci/build/style
5. **Rewrite** - Translate technical commits to user-friendly language. Lead with user benefit, strip jargon
6. **Assemble** - Format changelog for the target destination
7. **Output** - Write to CHANGELOG.md, GitHub Release, App Store, Slack, or internal format

For detailed step-by-step workflow (project detection scripts, commit parsing, categorization table, rewriting rules, assembly format) -> Read [reference/changelog-workflow.md](reference/changelog-workflow.md)

For output format examples (App Store, Keep a Changelog, internal/technical, Slack/email) -> Read [reference/changelog-workflow.md](reference/changelog-workflow.md)

## Key Rules

- Read `CLAUDE.md` first if it exists -- it describes the project's tech stack and conventions
- Always include: `feat:`, `fix:`, `perf:`, `security:`, `BREAKING CHANGE`
- Always skip: `refactor:`, `test:`, `chore:`, `ci:`, `build:`, `style:`
- Non-conventional commits: categorize by intent, include under "Improvements" if ambiguous
- Multi-platform repos: prefix entries with platform label (e.g., **Mobile App**, **Web App**, **Backend**)
- Single-platform repos: skip the label entirely

## Output Destinations

| Destination | Action |
|-------------|--------|
| `CHANGELOG.md` | Prepend to existing file (newest on top) |
| GitHub Release | Output as Markdown block ready to paste |
| App Store | Shorter format, no emoji, plain language, max 4000 chars |
| Slack / Email | Condensed summary with highlights only |
| Internal | Include technical details and commit hashes |

## Automation Tip

Suggest to the user: add a `pre-release` hook or CI step that runs this skill automatically when tagging a new version. Pair with the `/changelog` command for quick manual runs.

## Error Handling

**No conventional commits found**: Verify commit messages follow `type:` prefix format. Fall back to manual changelog if history is inconsistent.

**Ambiguous scope**: When a commit touches multiple features, split the changelog entry by affected area.
