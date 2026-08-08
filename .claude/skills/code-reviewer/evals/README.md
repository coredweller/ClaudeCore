# code-reviewer evals

Four suites, each testing a different failure mode of the `code-reviewer` skill. Each suite carries its own `rubric.json` — read it before touching the fixtures in that directory, it defines both what a case is testing and how it's scored.

| Suite | Tests | Rubric mode |
|---|---|---|
| `precision/` | Restraint — clean code that pattern-matches a checklist violation but isn't one in context | **in-prompt** (the rubric is shown to the reviewer; false positives don't get the excuse of an unfair hint) |
| `discriminating/` | Cross-file reasoning — defects only visible by reading multiple files together, each paired with a clean control | **withheld** (grading only; reviewer sees just the bundled files, like a real review) |
| `bespoke/` | House-convention recall — this repo's own rules (`.claude/rules/code-standards.md`), not generic best practice | **withheld** — this is the regression gate, re-run whenever `code-review-checklist.md` or the rules files change |
| `format/` | Output Contract compliance — does the report have the right shape, independent of which findings fire | **structural** (graded by regex/shape check, not judgment) |

## Structural integrity vs. content correctness

Everything on this page is about *content correctness* — does the reviewer catch the right thing — which requires a model to judge and is slow/costly/stochastic. There's a separate, deterministic, zero-token check for whether the eval set itself is internally consistent (fixtures leaking their own answers, manifests and fixtures drifting apart, malformed JSON, and an opt-in score-regression floor once real runs exist): see [`../harness/verify.mjs`](../harness/verify.mjs). It runs sub-second and has no dependencies — run it with `npm run verify:code-reviewer` from the repo root.

## Fixture format

Every fixture is plain source wrapped in `// ===== FILE: <path> =====` markers — one marker per virtual file, however many files the case needs. This is deliberately not a unified diff: the point is to hand the reviewer exactly the code in question, nothing more, so grading stays unambiguous about which lines were in scope.

## Running a case

1. Read the case's fixture file(s) and, for `precision/` only, fold the matching `trap` text from `rubric.json` into the prompt (that's what "in-prompt" means — the other three suites never show the reviewer their own rubric).
2. Ask a fresh reviewer (the `code-reviewer` agent, or the `code-reviewer` skill directly) to review the bundle as if it were a diff, per its normal Process/Output Contract.
3. Capture the output verbatim.
4. Grade against the suite's `rubric.json`:
   - `precision` / `bespoke`: binary per case — did it flag what it shouldn't, or fail to flag what it should.
   - `discriminating`: binary per case — defect identified AND clean control left alone.
   - `format`: binary per `checks[]` entry, case passes only if all checks pass.

To measure whether a suite is worth keeping, run every case across more than one model and look at the pass-rate spread, not just the average.

## The cut rule

> Any suite where every model scores 100% with zero variance across all its cases gets deleted.

A tier that always comes back green regardless of which model runs it isn't discriminating anything — it's just a fixed cost paid on every future eval run for a result nobody needed to check. Variance (a model failing some cases, passing others, or models disagreeing with each other) is what makes a tier worth keeping. This rule applies suite-by-suite, not case-by-case — a suite stays if *any* of its cases shows spread, even if others are saturated.

**No measurement pass has been run yet.** Everything above is methodology; nothing below the fixture inventory is real data. The suites, fixture counts, and severities in this repo are all provisional until the pass below actually runs — treat "the cut rule" as a promise, not a result.

## Next step: running the measurement pass (not yet done)

This is the exact, executable spec for the pass that decides what gets cut. Whoever runs it — a future session, a script, the user — should be able to follow this without re-deriving anything.

**Scale.** 20 fixtures × 3 models (Haiku, Sonnet, Opus) = 60 review runs, broken down as:

| Suite | Fixtures | × 3 models |
|---|---|---|
| `precision/` | 5 | 15 |
| `discriminating/` | 7 | 21 |
| `bespoke/` | 6 (3 pairs) | 18 |
| `format/` | 2 | 6 |
| **Total** | **20** | **60** |

Three models, not two — a cut decision made on a two-point spread (e.g. only Haiku vs. Sonnet) can't distinguish "this tier is flat" from "I only sampled the flat part of the curve." Opus is the point that would reveal a tier that's flat for weak/mid models but still discriminating at the top end (or vice versa).

**Per-run procedure, one call per (fixture × model):**

1. Build the prompt:
   - `precision/<case>`: fixture content + that case's `trap` field from `rubric.json`, stated plainly ("here's what to watch for: ..."). This is the one suite where the rubric is shown — the test is whether the model still avoids the false positive with the trap spelled out.
   - `discriminating/<case>`, `bespoke/<case>`: fixture content only. Never paste `rubric.json` into the prompt — it's grading-only.
   - `format/<case>`: fixture content only; no special framing beyond "review this."
   - In all cases, instruct the reviewer to treat the bundled `// ===== FILE =====` blocks as the full diff under review and to produce output per its normal Output Contract.
2. Dispatch via the `Agent` tool, `subagent_type: "code-reviewer"`, with `model` set to `haiku` / `sonnet` / `opus` for that run. Save the raw output.
3. Grade immediately against that suite's `rubric.json` (see "Running a case" above) — binary pass/fail per case, per model.

**Aggregation.** For each suite, build a pass/fail matrix (cases × models). Compute, per suite: pass rate per model, and whether any case has a split verdict across models (that's the variance signal — a case where all three models agree, whether always-pass or always-fail, contributes nothing to "does this suite discriminate").

**Applying the cut rule.** A suite is deleted only if its *entire* matrix is 100% pass with zero disagreement across all cases and all three models. One dissenting cell anywhere in the suite is enough to keep it. Deletion means removing the suite directory and its `rubric.json`, and updating the table at the top of this file plus the fixture inventory below.

**Writing up the result.** Replace this section (and the table/inventory above, if anything was cut) with: the actual pass/fail matrix per suite, which suites were kept vs. deleted and why, and — for anything deleted — a one-line acknowledgment of what coverage was lost by cutting it, so a future contributor doesn't wonder if it was an oversight.

## Fixture inventory

- `precision/` — 5 cases: allowlisted fetch, Stripe publishable key, `any` in a test mock, a secret read from the environment in `src/config/`, table-name-only SQL templating.
- `discriminating/` — 7 cases: IDOR, reinvented util, N+1, lost transaction atomicity, taint-to-exec, inverted authz, check-then-act race condition — each bundle includes a clean control alongside the defect.
- `bespoke/` — 3 house-convention pairs (violation + clean): no-silent-failures, unsafe type assertion on untrusted input, resource-lifecycle double-init guard.
- `format/` — 2 cases: a bundle with findings (expects FAIL), a clean bundle with none (expects PASS, and no padded Recommendations section).
