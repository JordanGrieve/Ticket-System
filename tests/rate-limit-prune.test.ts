import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The prune interval must outlive every window the code actually opens.
 *
 * `pruneRateLimits` deletes rows from `rate_limits`. Deleting one mid-count
 * does not merely lose a statistic — it RESETS the counter, so the next
 * request opens a fresh window and a caller that should have been refused is
 * let through. A rate limiter that silently forgets is worse than none,
 * because nothing looks wrong.
 *
 * This exists because the interval and the windows drifted apart within hours
 * of being written. The comment claimed "an hour of slack past the longest
 * window in use (10 minutes)"; the auto-reply mail-loop guards then landed with
 * 60-MINUTE windows against a one-hour prune, leaving zero margin. It was
 * caught by a reviewer reading two files at once, which is not a control.
 *
 * Parsing source rather than importing: lib/rate-limit-store.ts is
 * `server-only` and imports the database, so it cannot be loaded in a test that
 * must run without one. tests/campaign-schedule.test.ts reads vercel.json the
 * same way and for the same reason.
 */

const ROOT = process.cwd();

/** Whole hours from `interval 'N hours'` (or 'N hour') in the prune statement. */
function pruneIntervalMs(): number {
  const src = readFileSync(join(ROOT, "lib/rate-limit-store.ts"), "utf8");
  const del = src.slice(src.indexOf("DELETE FROM rate_limits"));
  const m = del.match(/interval\s+'(\d+)\s+hours?'/);
  if (!m) throw new Error("Could not find the prune interval in the DELETE");
  return Number(m[1]) * 60 * 60 * 1000;
}

/** Every `windowMs:` literal in application source, evaluated. */
function declaredWindows(): { file: string; ms: number }[] {
  const found: { file: string; ms: number }[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      // node_modules and agent worktrees are other people's copies of this
      // repo; a window declared there is not one this deployment opens.
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;

      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(/windowMs:\s*([0-9_ */+]+?)[,\s}]/g)) {
        const expr = m[1].replace(/_/g, "").trim();
        // Arithmetic only — never eval anything that is not digits and operators.
        if (!/^[0-9*+ /]+$/.test(expr)) continue;
        const ms = Function(`"use strict";return (${expr})`)() as number;
        if (Number.isFinite(ms) && ms > 0) {
          found.push({ file: full.slice(ROOT.length + 1), ms });
        }
      }
    }
  };

  walk(join(ROOT, "lib"));
  walk(join(ROOT, "app"));
  return found;
}

describe("prune interval vs the windows in use", () => {
  it("finds the windows at all", () => {
    // Guards the test itself: if the regex stops matching, every assertion
    // below passes vacuously and the protection quietly disappears.
    const windows = declaredWindows();
    expect(windows.length).toBeGreaterThan(3);
  });

  it("prunes well after the longest window has closed", () => {
    const prune = pruneIntervalMs();
    const windows = declaredWindows();
    const longest = windows.reduce((a, b) => (b.ms > a.ms ? b : a));

    expect(
      prune,
      `Prune deletes at ${prune / 3_600_000}h but the longest window is ` +
        `${longest.ms / 60_000} minutes (${longest.file}). Deleting a row ` +
        `mid-count RESETS the counter and lets a blocked caller through.`,
    ).toBeGreaterThan(longest.ms);
  });

  it("keeps a margin of at least 4x the longest window", () => {
    // Not just "greater than". The one-hour prune against a 60-minute window
    // was technically greater-than-or-equal and still wrong, because a window
    // becomes prunable at the exact moment it expires and clocks are not
    // simultaneous.
    const prune = pruneIntervalMs();
    const longest = declaredWindows().reduce((a, b) => (b.ms > a.ms ? b : a));
    expect(prune).toBeGreaterThanOrEqual(longest.ms * 4);
  });
});
