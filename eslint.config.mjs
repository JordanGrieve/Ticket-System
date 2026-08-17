import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Clerk skill templates — third-party sample code, not ours to
    // lint or fix. Without this, CI fails on someone else's <head> element.
    ".agents/**",
    // Scratch directories. A throwaway reproduction left in the repo root once
    // put 6,653 problems through the lint gate — none of them from source —
    // which reads as a failure to the next person and hides the real ones.
    // Nested node_modules and build output are never ours to lint.
    ".tmp-*/**",
    "**/node_modules/**",
    // Agent worktrees. These are full checkouts of the repo (git excludes them
    // via .git/info/exclude), each carrying its own .next build output, which
    // the ignores above do not reach because they are not at the repo root.
    // Left unignored they put ~37k problems through the gate — none from
    // source — which makes `npm run lint` useless as a signal and, worse, makes
    // the run abort with ENOENT when a concurrent build rewrites a chunk
    // mid-scan.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
