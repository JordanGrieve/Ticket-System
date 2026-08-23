import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The only thing this config exists for is the `server-only` alias below.
 *
 * `lib/config.ts` imports `server-only` so that pulling it into a client
 * component is a build error instead of a silent bundle leak (Sentry
 * POSTBOX-6). That package is a marker, not a library: its export map resolves
 * to an empty file under React's `react-server` condition and to a module whose
 * entire body is `throw new Error(...)` under every other condition. Next.js
 * applies the right condition per bundle. Vitest runs plain Node, gets the
 * throwing branch, and every suite that touches config dies on import.
 *
 * Aliasing it to the empty file gives the tests the same view of the module
 * that server code gets, which is the environment they are actually asserting
 * about. It does not weaken the guard — the guard is enforced at build time by
 * Next, and `npm run build` still fails if a client component reaches config.
 */
export default defineConfig({
  test: {
    /**
     * Agent worktrees are full checkouts of this repo, each with its own
     * `tests/` directory, and they live inside the project root. Without this
     * exclusion vitest collects them: the suite ran 31 files when the repo has
     * 11, reporting another branch's copy of every test as if it were ours.
     *
     * That is worse than noise. A green run would be partly green about code
     * that is not on this branch, a suite deleted here still "passes" from a
     * stale copy, and the single deliberate `it.fails` in
     * tests/auto-reply-loop-guards.test.ts is counted once per checkout — which
     * is why the expected-fail total read 3 instead of 1.
     */
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
  resolve: {
    /*
     * An ARRAY, not an object, because order matters: Vite tries these in turn
     * and the specific `@/db` entry has to be attempted before the catch-all
     * `@/` one, or every import would resolve through the catch-all and the
     * stub would never be used.
     */
    alias: [
      {
        // fileURLToPath, not URL.pathname: on Windows the latter yields
        // "/C:/Users/Jordan%20Grieve/..." — leading slash, percent-encoded
        // spaces — which resolves to nothing.
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./node_modules/server-only/empty.js", import.meta.url),
        ),
      },
      {
        /*
         * db/index.ts throws at import when DATABASE_URL is unset, and then
         * runs db/guard.ts to refuse an undeclared database. Both are right —
         * that guard exists because local dev once silently pointed at a live
         * client's records — but together they make every module that touches
         * the database unimportable in a suite which deliberately has no
         * DATABASE_URL and should never acquire one.
         *
         * The stub throws on ANY use rather than pretending to be a database.
         * A permissive fake would let a test that reached a real query look
         * like it passed while exercising nothing, which is worse than the
         * import error it replaced.
         */
        find: /^@\/db$/,
        replacement: fileURLToPath(
          new URL("./tests/stubs/db.ts", import.meta.url),
        ),
      },
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./", import.meta.url)),
      },
    ],
  },
});
