#!/usr/bin/env node
/**
 * Fallback coverage summarizer for the frontend.
 *
 * `npm run test:coverage` (vitest run --coverage) collects raw per-test-file
 * V8 coverage into frontend/coverage/.tmp/coverage-*.json, but in this
 * environment the final report-generation step (merge -> istanbul conversion
 * -> text/html output) does not run to completion -- no error is raised, the
 * test run exits 0/1 normally depending on pass/fail, but coverage/ is left
 * containing only the raw .tmp files. This was reproduced identically via
 * npm, npx, PowerShell vs. git-bash, and both the default "threads" and
 * "forks" pools, so it looks like an environment-specific issue with this
 * vitest 1.6.1 / @vitest/coverage-v8 1.6.1 combination rather than anything
 * about the tests themselves.
 *
 * This script reads those raw .tmp files directly and computes an
 * approximate BLOCK coverage percentage per source file: for every function
 * range V8 recorded, the byte-length of ranges with a nonzero execution
 * count, divided by the total byte-length of all recorded ranges. This is
 * computed on Vite's transformed module code (no sourcemap remapping back to
 * the original JSX/JS, which is what v8-to-istanbul would normally do), so
 * treat the percentages as indicative, not the same number a working
 * `npm run test:coverage` would report.
 *
 * Usage: node frontend_coverage_fallback.js <path-to-frontend/coverage/.tmp>
 */
const fs = require('fs');
const path = require('path');

const tmpDir = process.argv[2];
if (!tmpDir) {
  console.error('Usage: node frontend_coverage_fallback.js <path-to-coverage/.tmp>');
  process.exit(1);
}

const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.json'));
// url -> Map<rangeKey, {length, covered}>  (dedup identical ranges across files, OR-ing "covered")
const perFile = new Map();

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(tmpDir, f), 'utf8'));
  for (const script of data.result || []) {
    // file:// URLs always use forward slashes, regardless of platform.
    if (!script.url.includes('/frontend/src/')) continue;
    if (script.url.includes('/src/test/')) continue;
    if (script.url.includes('.test.')) continue;

    if (!perFile.has(script.url)) perFile.set(script.url, new Map());
    const ranges = perFile.get(script.url);
    for (const fn of script.functions || []) {
      for (const r of fn.ranges || []) {
        const key = `${r.startOffset}-${r.endOffset}`;
        const existing = ranges.get(key);
        const covered = r.count > 0;
        if (!existing) {
          ranges.set(key, { length: r.endOffset - r.startOffset, covered });
        } else if (covered) {
          existing.covered = true;
        }
      }
    }
  }
}

const rows = [];
let totalLen = 0;
let totalCovered = 0;
for (const [url, ranges] of perFile) {
  let len = 0;
  let covered = 0;
  for (const { length, covered: c } of ranges.values()) {
    len += length;
    if (c) covered += length;
  }
  totalLen += len;
  totalCovered += covered;
  const rel = url.split('frontend/src/')[1] || url.split('frontend\\src\\')[1] || url;
  rows.push({ file: 'src/' + rel, pct: len > 0 ? (100 * covered / len) : 0 });
}

rows.sort((a, b) => a.pct - b.pct);
console.log('Approximate block coverage (see script docstring for methodology/caveats):\n');
for (const r of rows) {
  console.log(`  ${r.pct.toFixed(1).padStart(5)}%  ${r.file}`);
}
console.log(`\nOverall (byte-weighted): ${(100 * totalCovered / totalLen).toFixed(1)}% across ${rows.length} files`);
