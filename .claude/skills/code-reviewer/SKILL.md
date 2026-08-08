---
name: code-reviewer
description: Reviews a diff for security, architecture, error-handling, and quality defects against a fixed checklist and output contract. Use after writing or modifying code, when auditing quality, and for PR review invoked as `--pr <n>`, a bare PR number, or a GitHub pull-request URL.
allowed-tools: Bash, Read, Glob, Grep, Write
---

# Code Reviewer

Reviews security, architecture, error handling, quality, and performance against [reference/code-review-checklist.md](reference/code-review-checklist.md), which carries the severity tag for every rule and the Output Contract every review must produce. Read it before reporting — severities are copied from it, never re-judged.

## Invocation Modes

- **No argument** or **`--mine`** — review the current branch; deliver as session text.
- **`--pr <n>`**, a **bare number** (e.g. `123`), or a **PR URL** (`https://github.com/<owner>/<repo>/pull/<n>`) — review someone else's PR. Extract the PR number, plus `<owner>/<repo>` if the URL names a repo other than the cwd's `origin`.

## Process

Four phases, each with a tool-call budget, so review effort never leaks into re-reading things already gathered.

### Phase 1 — Context

**Local / `--mine` — budget 2–3 calls:**
1. `git diff` against the appropriate base (uncommitted work, or the branch vs. its merge-base with the default branch) — its diff headers double as the changed-file list.
2. `git rev-parse --abbrev-ref HEAD ; git log -1 --date=short --format=%cd` — one call, both remaining header fields. Extract the ticket ID from the branch name by regex (e.g. `PROJ-1234`); that costs nothing.
3. Spend a third call on `git diff --name-only` only if #1's headers don't cleanly enumerate the changed files.

Use `;` between those two commands, not `&&` — `&&` is a parse error in Windows PowerShell 5.1, and `;` separates statements in both PowerShell and POSIX shells. Likewise prefer `git rev-parse --abbrev-ref HEAD` over `git branch --show-current`, which needs git ≥ 2.22 and errors out on older installs.

**PR mode — budget 2–3 calls:**
1. Resolve the PR number (and `owner/repo`) from the invocation — no call.
2. **Run these two in the same batch — they're independent, and serializing them wastes budget:**
   - `gh pr view <n> [--repo <owner>/<repo>] --json number,title,url,author,baseRefName,headRefName,headRefOid,updatedAt`
   - `gh pr diff <n> [--repo <owner>/<repo>]`

   Branch, ticket, and date all come from that metadata — `headRefName`, `title`, and `updatedAt` — so the header costs no extra call. Never `gh pr checkout`: it mutates the worktree (see Safety Rules) and nothing here needs a checked-out copy.
3. Spend a third call on `gh pr view <n> --json files` only if the diff doesn't already make the changed-file list obvious.

**PR mode only — ask the delivery target now, before Phase 2**, so delivery is settled before review effort is spent:
- **(a) Session text** — print findings per the Output Contract.
- **(b) Self-contained HTML report** — write `./pr-<n>-review.html`: one new file, inline CSS, no external requests or scripts. The sole permitted use of `Write` in this skill.
- **(c) Inline GitHub review** — post via `gh api .../reviews` (Phase 4). This writes to a shared, visible system: show the user the exact queued comments and get explicit confirmation before Phase 4 posts.

> (b) and (c) exist only when this skill is invoked directly. The `code-reviewer` **agent** is read-only — when running as that agent, deliver (a) and don't offer the choice.

### Phase 2 — Review (targeted reads only)

No fixed budget. Every `Read`/`Grep`/`Glob` call must trace to one specific question the diff raises — DRY, caller impact, layer imports (see Scope). Never sweep the wider tree looking for more to check.

### Phase 3 — Report — budget: 0 tool calls

Analyze entirely from what Phases 1–2 gathered. Do not open another file or re-run git/gh "just to double check." If something is genuinely uncertain, write the finding as **"needs verification"** rather than spending a call — the human chases it down, not you. Produce the verdict and findings here.

### Phase 4 — Deliver

- **(a) Session text** — 0 calls; Phase 3's output, printed.
- **(b) HTML report** — 1 call: `Write` the Phase 3 report to `./pr-<n>-review.html`.
- **(c) GitHub review** — 1 call: `gh api repos/<owner>/<repo>/pulls/<n>/reviews`, POST body:
  - `event` — map the Phase 3 verdict: PASS → `APPROVE`, WARNINGS → `COMMENT`, FAIL → `REQUEST_CHANGES`.
  - `comments[]` — one entry per **pinnable** finding: `{ path, line, side: "RIGHT", body }` (markdown body). For a finding spanning a range, set `line` to the **last line** of that range — don't use `start_line`/`line` pairs.
  - `body` — top-level review text: a short summary plus every **unpinnable** finding (file-level, cross-file, or no reliable single-line anchor).

  If this call fails on auth, TLS, or permission grounds, don't retry or work around it — print the full Phase 3 report in-session with the error included, so the review isn't lost.

## Scope (Non-Negotiable)

Review the diff, not the codebase. Findings are limited to lines the author introduced or modified — in PR mode "the diff" means `gh pr diff <n>`, not the local `git diff`.

- **Out of scope:** pre-existing issues elsewhere in a touched file, or anywhere else in the project. Do not flag them, even when real; do not scan or grep the wider tree looking for issues to add.
- **Targeted reads are allowed only to answer a specific question the diff raises** — does this duplicate an existing utility, who calls this and how does the change affect them, does this import violate layering. Use Read/Grep/Glob narrowly for that one question, then return to the diff.
- A real pre-existing issue surfaced that way may get one "Out of scope, noted for awareness" line, separate from the findings list. It must never affect the verdict.

## Safety Rules (Non-Negotiable)

This skill never modifies the codebase or existing repository state. It has exactly two exceptions, both PR-mode-only and both opt-in via the Phase 1 delivery question:

- **Delivery (b)** writes one new file, `./pr-<n>-review.html`. Never use `Write` for anything else — never to edit an existing file.
- **Delivery (c)** posts one new PR review. It only adds; it never rewrites or deletes an existing comment, review, commit, or branch.

Everything else is read-only:

- Never run destructive or history-altering git commands: `git stash`, `git reset` (any form), `git clean`, `git checkout -- <path>` / `git checkout .` / `git restore`, `git branch -D`, `git push --force`, `git commit --amend`, `git rebase`.
- Never force a branch switch. If `git checkout <branch>` fails, do not stash/reset/discard local state to make it work — run `git fetch origin` (read-only) and compare via `git diff origin/main...origin/<branch>`, or inspect content with `git show origin/<branch>:<path>`. In PR mode, prefer `gh pr diff` / `gh pr view` over checkout entirely.
- Bash is for read-only inspection only (`git diff`, `git log`, `git show`, `git blame`, `git fetch`, read-only lint/test runs, `gh pr view`, `gh pr diff`). Never use it to edit files (no `sed -i`, no redirection into tracked files, no `rm`) — the only writes this skill performs are the two exceptions above.
- If the worktree looks wrong (unexpected uncommitted changes, mid-rebase/merge, detached HEAD), report it as a finding — do not fix or clean it up.

## Error Handling

If no changes are found, report "No changes detected" and list the files/paths searched.
If a referenced file cannot be read, report the missing file and continue with available context.
