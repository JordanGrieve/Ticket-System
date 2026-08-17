import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
  resolve: {
    alias: {
      // fileURLToPath, not URL.pathname: on Windows the latter yields
      // "/C:/Users/Jordan%20Grieve/..." — leading slash, percent-encoded
      // spaces — which resolves to nothing.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
});
