#!/usr/bin/env node
/**
 * Deterministic, zero-token CI gate for the code-reviewer skill's evals/.
 *
 * This does NOT run any eval — it never invokes a model. It only checks that
 * the eval set itself is internally consistent, which is cheap, sub-second,
 * and can run on every commit. The expensive/stochastic part (does the
 * reviewer actually catch the right thing) stays a separate, manual,
 * LLM-driven pass — see evals/README.md.
 *
 * Four checks:
 *   1. Leak guard          — no fixture (*.txt) reveals its own answer key.
 *   2. Manifest/fixture integrity — every reference resolves, nothing orphaned,
 *                             no duplicates, expected_verdict values are valid.
 *   3. JSON validity        — every *.json under evals/ parses.
 *   4. Score-regression floor (opt-in) — see "Run-dir schema" below.
 *
 * Exit code 0 = all checks pass. Exit code 1 = at least one failed.
 *
 * ---------------------------------------------------------------------------
 * Run-dir schema (for check 4)
 * ---------------------------------------------------------------------------
 * This part of the eval harness is genuinely new — no eval has been executed
 * yet (see evals/README.md, "Next step: running the measurement pass"), so
 * there is no prior convention to match. This is the schema a future
 * execution pass should write to, under evals/runs/<run-id>/:
 *
 *   meta.json             { "suite": "precision", "manifest": "precision/rubric.json",
 *                            "model": "sonnet", "created": "2026-01-01T00:00:00Z" }
 *     - `manifest` is a path relative to evals/, used to validate that every
 *       case id in results.json actually exists in that suite.
 *
 *   results.json           { "cases": [
 *                               { "id": "01-allowlisted-fetch", "model": "sonnet",
 *                                 "ground_truth_flag": false, "model_flagged": false },
 *                               ...
 *                            ] }
 *     - One entry per (case, model) run. `ground_truth_flag` is what the
 *       rubric says SHOULD happen (true if the case's expected_verdict is
 *       FLAG); `model_flagged` is what the captured run actually did.
 *
 *   expected-scores.json   { "recall_min": 0.8, "precision_min": 0.9, "cases_min": 5 }
 *     - OPT-IN marker. A run-dir is only score-gated if this file is present.
 *       Any subset of the three keys may be given; only present keys are
 *       enforced. A run-dir without this file is just captured data — check 4
 *       skips it, no failure.
 *
 * recall = TP / (TP + FN), precision = TP / (TP + FP), both over the
 * (ground_truth_flag, model_flagged) pairs in results.json. If a metric's
 * denominator is 0 (e.g. recall on an all-NO_FLAG suite like precision/),
 * that floor is reported as not-applicable and skipped, not failed —
 * dividing by zero shouldn't block a commit.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = dirname(HARNESS_DIR);
const EVALS_DIR = join(SKILL_DIR, 'evals');
const SUITE_NAMES = ['precision', 'discriminating', 'bespoke', 'format'];
const VERDICT_ENUM = new Set(['FLAG', 'NO_FLAG', 'STRUCTURAL']);

const failures = [];
const info = [];

function fail(check, message) {
  failures.push(`[${check}] ${message}`);
}

function note(message) {
  info.push(message);
}

function toPosix(p) {
  return p.split(sep).join('/');
}

/** Recursively list files under `dir` whose name matches `pattern`, skipping any directory named in `skipDirs`. */
function walk(dir, pattern, skipDirs = new Set()) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      results.push(...walk(join(dir, entry.name), pattern, skipDirs));
    } else if (pattern.test(entry.name)) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Check 3 runs first: every other check needs parsed JSON, so a manifest that
// fails to parse should be reported once here and then skipped everywhere
// else, rather than re-discovered as a confusing secondary failure.
// ---------------------------------------------------------------------------
function checkJsonValidityAndLoad() {
  const jsonFiles = walk(EVALS_DIR, /\.json$/);
  const parsed = new Map(); // absolute path -> parsed value

  for (const file of jsonFiles) {
    const rel = toPosix(relative(EVALS_DIR, file));
    try {
      parsed.set(file, JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      fail('json-validity', `${rel} — ${e.message}`);
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Check 2: manifest/fixture integrity
// ---------------------------------------------------------------------------
function checkManifestFixtureIntegrity(parsedJson) {
  const manifestPaths = SUITE_NAMES
    .map((s) => join(EVALS_DIR, s, 'rubric.json'))
    .filter((p) => parsedJson.has(p));

  if (manifestPaths.length === 0) {
    fail('integrity', 'no rubric.json found under any known suite directory');
    return;
  }

  // absolute fixture path -> set of "suite/rubric.json" strings that reference it
  const referencedBy = new Map();

  for (const manifestPath of manifestPaths) {
    const manifest = parsedJson.get(manifestPath);
    const manifestDir = dirname(manifestPath);
    const manifestRel = toPosix(relative(EVALS_DIR, manifestPath));
    const cases = Array.isArray(manifest.cases) ? manifest.cases : [];

    const seenIds = new Set();
    const seenFilesInThisManifest = new Set();

    for (const c of cases) {
      if (!c || typeof c !== 'object') {
        fail('integrity', `${manifestRel} — case entry is not an object`);
        continue;
      }
      if (!c.id) {
        fail('integrity', `${manifestRel} — case missing "id"`);
      } else if (seenIds.has(c.id)) {
        fail('integrity', `${manifestRel} — duplicate case id "${c.id}" (double-listing)`);
      } else {
        seenIds.add(c.id);
      }

      // A case references fixtures via one of: file, violation_file, clean_file.
      const fileFields = ['file', 'violation_file', 'clean_file'].filter((f) => c[f]);
      if (fileFields.length === 0) {
        fail('integrity', `${manifestRel} — case "${c.id ?? '?'}" references no fixture file`);
      }
      for (const field of fileFields) {
        const relPath = c[field];
        const absPath = join(manifestDir, relPath);
        if (seenFilesInThisManifest.has(absPath)) {
          fail('integrity', `${manifestRel} — case "${c.id}" lists ${field}="${relPath}" more than once in this manifest`);
        }
        seenFilesInThisManifest.add(absPath);

        if (!existsSync(absPath) || !statSync(absPath).isFile()) {
          fail('integrity', `${manifestRel} — case "${c.id}" points at missing file: ${relPath}`);
        } else {
          if (!referencedBy.has(absPath)) referencedBy.set(absPath, new Set());
          referencedBy.get(absPath).add(manifestRel);
        }
      }

      // expected_verdict enum, wherever it appears on this case.
      for (const field of ['expected_verdict', 'violation_expected_verdict', 'clean_expected_verdict']) {
        if (field in c && !VERDICT_ENUM.has(c[field])) {
          fail(
            'integrity',
            `${manifestRel} — case "${c.id}" has ${field}="${c[field]}", not one of ${[...VERDICT_ENUM].join('/')}`,
          );
        }
      }
    }
  }

  // Orphan check: every *.txt fixture under evals/ (excluding the runs/ capture
  // area, which holds captured output, not fixtures) must be referenced by at
  // least one manifest — not necessarily its own suite's, since format/ reuses
  // bespoke/'s fixtures on purpose.
  const allFixtures = walk(EVALS_DIR, /\.txt$/, new Set(['runs']));
  for (const fixture of allFixtures) {
    if (!referencedBy.has(fixture)) {
      fail('integrity', `orphan fixture, referenced by no manifest: ${toPosix(relative(EVALS_DIR, fixture))}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 1: leak guard
// ---------------------------------------------------------------------------
const GENERIC_LEAK_PATTERNS = [
  { name: 'NEAR-MISS tag', re: /\bNEAR-MISS\b/ },
  { name: 'MULTI tag', re: /\bMULTI\b/ },
  { name: '"should be N" verdict phrasing', re: /\bshould be \d+\b/i },
  { name: '"must NOT flag" verdict phrasing', re: /\bmust not flag\b/i },
  { name: 'rule-id phrasing', re: /\brule[- ]?id\b/i },
];

// Case fields that hold answer-key prose (as opposed to fields that legitimately
// point at real code, like file/flagged_path/flagged_line_pattern — those are
// SUPPOSED to match fixture content, that's not a leak).
const ANSWER_FIELDS = [
  'defect',
  'convention',
  'trap',
  'note',
  'must_identify',
  'must_identify_in_violation',
  'must_not_flag_as_same_defect',
];

function checkLeakGuard(parsedJson) {
  // Build: absolute fixture path -> [needle strings drawn from the case(s) that reference it]
  const needlesByFixture = new Map();

  for (const suite of SUITE_NAMES) {
    const manifestPath = join(EVALS_DIR, suite, 'rubric.json');
    if (!parsedJson.has(manifestPath)) continue;
    const manifest = parsedJson.get(manifestPath);
    const manifestDir = dirname(manifestPath);
    for (const c of manifest.cases ?? []) {
      const fileFields = ['file', 'violation_file', 'clean_file'].filter((f) => c[f]);
      const needles = [c.id, ...ANSWER_FIELDS.map((f) => c[f]).filter(Boolean)];
      for (const field of fileFields) {
        const absPath = join(manifestDir, c[field]);
        if (!needlesByFixture.has(absPath)) needlesByFixture.set(absPath, []);
        needlesByFixture.get(absPath).push(...needles);
      }
    }
  }

  const allFixtures = walk(EVALS_DIR, /\.txt$/, new Set(['runs']));
  for (const fixture of allFixtures) {
    const rel = toPosix(relative(EVALS_DIR, fixture));
    const content = readFileSync(fixture, 'utf8');

    for (const needle of needlesByFixture.get(fixture) ?? []) {
      if (content.includes(needle)) {
        fail('leak-guard', `${rel} contains its own answer-key text: "${needle}"`);
      }
    }

    for (const { name, re } of GENERIC_LEAK_PATTERNS) {
      if (re.test(content)) {
        fail('leak-guard', `${rel} matches suspicious pattern (${name})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 4: score-regression floor (opt-in — see header comment for schema)
// ---------------------------------------------------------------------------
function checkScoreRegressionFloor(parsedJson) {
  const runsDir = join(EVALS_DIR, 'runs');
  if (!existsSync(runsDir)) {
    note('score-regression floor: no evals/runs/ directory — skipped (opt-in, nothing captured yet)');
    return;
  }

  const runDirs = readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (runDirs.length === 0) {
    note('score-regression floor: evals/runs/ exists but is empty — skipped');
    return;
  }

  for (const { name: runId } of runDirs) {
    const runDir = join(runsDir, runId);
    const expectedScoresPath = join(runDir, 'expected-scores.json');
    if (!existsSync(expectedScoresPath)) {
      note(`score-regression floor: runs/${runId} has no expected-scores.json — not opted in, skipped`);
      continue;
    }

    const metaPath = join(runDir, 'meta.json');
    const resultsPath = join(runDir, 'results.json');
    if (!parsedJson.has(metaPath) || !parsedJson.has(resultsPath)) {
      fail('score-floor', `runs/${runId} has expected-scores.json but is missing meta.json and/or results.json`);
      continue;
    }

    const expectedScores = parsedJson.get(expectedScoresPath);
    const meta = parsedJson.get(metaPath);
    const results = parsedJson.get(resultsPath);

    const referencedManifestPath = join(EVALS_DIR, meta.manifest ?? '');
    if (!parsedJson.has(referencedManifestPath)) {
      fail('score-floor', `runs/${runId}/meta.json points at unknown manifest: "${meta.manifest}"`);
      continue;
    }
    const validIds = new Set((parsedJson.get(referencedManifestPath).cases ?? []).map((c) => c.id));

    const cases = Array.isArray(results.cases) ? results.cases : [];
    let tp = 0, fp = 0, fn = 0;
    const uniqueIds = new Set();

    for (const entry of cases) {
      if (!validIds.has(entry.id)) {
        fail('score-floor', `runs/${runId}/results.json — case id "${entry.id}" not found in ${meta.manifest}`);
        continue;
      }
      uniqueIds.add(entry.id);
      if (entry.ground_truth_flag && entry.model_flagged) tp++;
      else if (!entry.ground_truth_flag && entry.model_flagged) fp++;
      else if (entry.ground_truth_flag && !entry.model_flagged) fn++;
    }

    const recall = tp + fn > 0 ? tp / (tp + fn) : null;
    const precision = tp + fp > 0 ? tp / (tp + fp) : null;
    const casesCount = uniqueIds.size;

    if ('recall_min' in expectedScores) {
      if (recall === null) note(`runs/${runId}: recall_min set but no positive ground-truth cases — not applicable, skipped`);
      else if (recall < expectedScores.recall_min) fail('score-floor', `runs/${runId} — recall ${recall.toFixed(2)} below floor ${expectedScores.recall_min}`);
    }
    if ('precision_min' in expectedScores) {
      if (precision === null) note(`runs/${runId}: precision_min set but no flagged cases — not applicable, skipped`);
      else if (precision < expectedScores.precision_min) fail('score-floor', `runs/${runId} — precision ${precision.toFixed(2)} below floor ${expectedScores.precision_min}`);
    }
    if ('cases_min' in expectedScores && casesCount < expectedScores.cases_min) {
      fail('score-floor', `runs/${runId} — only ${casesCount} cases captured, floor is ${expectedScores.cases_min}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const start = Date.now();
const parsedJson = checkJsonValidityAndLoad();
checkManifestFixtureIntegrity(parsedJson);
checkLeakGuard(parsedJson);
checkScoreRegressionFloor(parsedJson);
const elapsedMs = Date.now() - start;

for (const line of info) console.log(`  · ${line}`);

if (failures.length > 0) {
  console.error(`\n✗ verify.mjs: ${failures.length} failure(s) (${elapsedMs}ms)\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
} else {
  console.log(`\n✓ verify.mjs: all checks passed (${elapsedMs}ms)`);
  process.exit(0);
}
