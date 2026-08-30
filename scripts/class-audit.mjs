import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Find class names used in TSX that no stylesheet defines.
 *
 * Same shape of silent failure as an undefined var(): the element renders, the
 * build passes, nothing warns, and the thing simply has no styling. It reads
 * as a design choice rather than a fault, which is why this kind of bug lives
 * for weeks.
 *
 * Exploratory, not a test. It has known false positives — class names built at
 * runtime, names coming from a third party, names only ever used by another
 * stylesheet — so the output is a list to TRIAGE, never a list to fix. That
 * distinction matters: a harness reporting a false failure nearly caused a
 * "fix" to working code earlier today.
 *
 * ── TRIAGE, 30 AUGUST 2026 — READ THIS BEFORE ACTING ON THE OUTPUT ──
 * Ran against the whole tree. Eleven hits, NO BUGS. Recorded so nobody has to
 * work through them a second time:
 *
 *   .legal-prose      NOT a hit any more. It is defined in an inline <style>
 *                     block in app/(legal)/layout.tsx, scoped deliberately to
 *                     those two pages. The first version of this script only
 *                     read .css files and reported it as unstyled — which is
 *                     why the scan now includes inline blocks.
 *
 *   .active           False positives. Fragments of template literals:
 *   .tone             `pba-navrow${active ? " is-active" : ""}` and
 *   .pba-pill-        `pba-pill pba-pill-${tone}`. The splitter cannot tell a
 *                     literal run from an interpolation boundary.
 *
 *   .mono             Real, and INERT. Seven class names carried on elements
 *   .nl-card--preview that no rule matches, left behind by renames. Nothing
 *   .pbm-btn--quiet   queries them from JavaScript or a test, and none has a
 *   .pbm-main         user-visible effect: .pbm-main in particular looks load-
 *   .pbm-nav          bearing but is not — the mail layout's row direction
 *   .pshot-folder-    comes from `.pbm .pb-main`, not from this class.
 *      label
 *   .stg-h2
 *
 * Deliberately NOT removed. Deleting seven attributes across seven files buys
 * no behaviour, no bytes worth counting and no clarity a reader would notice,
 * and every edit is a chance to remove the one that turns out to matter. They
 * are listed here so the next run is a five-second comparison rather than an
 * afternoon.
 *
 * There is no test wrapping this, for the same reason: a guard needing a
 * seven-entry allowlist on day one is maintenance without a defect to prevent.
 * Run it after a big rename, when the list is expected to have changed.
 */

const collect = (dir, ext, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|\.next|\.git|worktrees/.test(full)) collect(full, ext, acc);
    } else if (entry.name.endsWith(ext)) {
      acc.push(full);
    }
  }
  return acc;
};

const cssFiles = [...collect("app", ".css"), ...collect("components", ".css")];
const tsxFiles = [...collect("app", ".tsx"), ...collect("components", ".tsx")];

const defined = new Set();
const addSelectors = (text) => {
  for (const m of text.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);
};

for (const file of cssFiles) addSelectors(readFileSync(file, "utf8"));

/*
 * Stylesheets are not only .css files. app/(legal)/layout.tsx defines
 * .legal-prose in an inline <style> block, scoped deliberately to those two
 * pages — and the first version of this audit reported it as unstyled because
 * it only read .css. Reporting styled things as unstyled is how a triage list
 * stops being read.
 */
for (const file of tsxFiles) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)) {
    addSelectors(m[1]);
  }
}

const used = new Map();
for (const file of tsxFiles) {
  const source = readFileSync(file, "utf8");
  // Literal runs only: a plain string, or the literal parts of a template.
  for (const m of source.matchAll(
    /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g,
  )) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    for (const piece of raw.split(/[\s${}?:()|&+'"]+/)) {
      const cls = piece.trim();
      if (!cls || !/^[a-zA-Z][\w-]*$/.test(cls)) continue;
      if (!used.has(cls)) used.set(cls, new Set());
      used.get(cls).add(file.split(sep).join("/"));
    }
  }
}

/** Third-party or state classes that legitimately have no rule of ours. */
const IGNORE = /^(cl-|is-|has-|sr-only$)/;

const missing = [...used.keys()]
  .filter((c) => !defined.has(c) && !IGNORE.test(c))
  .sort();

console.log(
  `css ${cssFiles.length} | tsx ${tsxFiles.length} | defined ${defined.size} | used ${used.size}`,
);
console.log(`\nUSED IN TSX, NO CSS RULE — ${missing.length} to triage:`);
for (const cls of missing) {
  console.log(`  .${cls}\n      ${[...used.get(cls)].join("\n      ")}`);
}
