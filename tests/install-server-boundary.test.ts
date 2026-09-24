import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Install page ships only its toggles to the browser.
 *
 * InstallView was one "use client" file for the sake of two mode toggles and
 * a Show more button, so every prompt string in it — a couple of hundred
 * lines written for a language model — and all of lib/highlight.ts went into
 * the client bundle of a page most clients open once. It is a server
 * component now: the strings are built and coloured there, and only
 * InstallModes and InstallCodeBlock are client code, receiving the results.
 *
 * What would undo it silently is a directive creeping back onto InstallView,
 * or a client file importing the highlighter for real rather than for its
 * types. Both are read from the source, where they live.
 */

const read = (file: string) => readFileSync(join(process.cwd(), "components", file), "utf8");
const directive = (src: string) => /^\s*["']use client["']/.test(src);

describe("the Install page's client boundary", () => {
  it("InstallView is a server component", () => {
    const src = read("InstallView.tsx");
    expect(src).toContain("export default function InstallView");
    expect(directive(src), "InstallView.tsx opens with \"use client\" again").toBe(false);
  });

  for (const file of ["InstallModes.tsx", "InstallCodeBlock.tsx"]) {
    it(`${file} is the client half`, () => {
      expect(directive(read(file))).toBe(true);
    });

    it(`${file} does not bring the highlighter or the prompts with it`, () => {
      const src = read(file);
      const imports = src.match(/^import [^;]+;/gm) ?? [];
      expect(imports.length, "no imports read — this check is looking at nothing").toBeGreaterThan(0);
      for (const line of imports.filter((l) => l.includes("highlight"))) {
        expect(line, "a runtime import of lib/highlight in client code").toMatch(/^import type /);
      }
      expect(src).not.toContain("wordingRules");
      expect(src).not.toContain("buildNewsletterAiPrompt");
    });
  }
});
