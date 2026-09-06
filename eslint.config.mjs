import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /*
    The keyboard half of accessibility, which Next's preset does not turn on.

    eslint-plugin-jsx-a11y ships with eslint-config-next and is already
    running, but core-web-vitals enables only the ARIA-attribute rules —
    alt-text, aria-props, role-has-required-aria-props and friends. The rules
    about whether a thing can be REACHED and OPERATED from a keyboard are all
    off by default, which is how a click handler on a plain <div> gets past a
    green lint run.

    These were added on 6 Sep 2026 after auditing 2,891 JSX tags by hand and
    finding four click handlers on non-native elements. Three were scrims
    marked aria-hidden, which the plugin correctly ignores because a hidden
    element is not in the accessibility tree at all. The fourth was real enough
    to need a written justification, which it now has in MailNavShell.

    Kept as errors rather than warnings: a warning in a CI that only fails on
    errors is a comment, and this is the class of bug nobody sees by looking.
  */
  {
    files: ["**/*.tsx"],
    rules: {
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/label-has-associated-control": "error",
    },
  },
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
