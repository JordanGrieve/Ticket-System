"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "./icons";

/**
 * The search box that actually searches.
 *
 * Deliberately a plain <form> with a GET-shaped submit rather than a
 * type-as-you-go query: every keystroke here is four sequential scans across a
 * tenant's tickets, messages, contacts and labels (lib/search.ts), so the
 * request is tied to Enter / the submit button. The list pane's own box stays
 * what it always was — an on-page refine of already-loaded rows — and the two
 * are different enough that merging them would make one of them lie.
 *
 * IMPORTANT: this component must never import lib/config, lib/tickets or
 * lib/search, directly or transitively. It is a client component; lib/search
 * carries `server-only` and dragging it into the bundle is a build error, and
 * before that guard existed the same mistake took every authed page down
 * (see the header of lib/ticket-format.ts).
 */

export default function SearchField({
  /** Current query, so the field on the results page shows what was searched. */
  initialQuery = "",
  placeholder = "Search mail, people, labels…",
  /** Focus on mount — right on the results page, wrong inside the list pane. */
  autoFocus = false,
}: {
  initialQuery?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initialQuery);
  const [seeded, setSeeded] = useState(initialQuery);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // A server navigation to /search?q=… re-renders this with a new
  // `initialQuery`, but React keeps the existing state for a mounted input.
  // Without this, the browser's Back button leaves the field showing the query
  // you typed while the results below show the one you came back to.
  //
  // Adjusted DURING render rather than in an effect: React re-runs this
  // component immediately with the new state and never commits the stale
  // frame, so there is no flash of the wrong query — and no cascading render
  // after paint, which is what react-hooks/set-state-in-effect is about.
  if (seeded !== initialQuery) {
    setSeeded(initialQuery);
    setValue(initialQuery);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q.length === 0) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form className="pbm-search pbm-search--go" role="search" onSubmit={submit}>
      <span className="pbm-search-icon" aria-hidden>
        <SearchIcon size={16} />
      </span>
      <input
        ref={inputRef}
        className="pbm-search-input"
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Esc clears the field rather than only clearing the browser's own
          // search-input affordance, which is invisible in most themes.
          if (e.key === "Escape" && value !== "") {
            e.preventDefault();
            setValue("");
            inputRef.current?.focus();
          }
        }}
        placeholder={placeholder}
        aria-label="Search mail, people and labels"
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      <button
        type="submit"
        className="pbm-search-go"
        disabled={value.trim().length === 0}
        aria-label="Search"
      >
        Search
      </button>
    </form>
  );
}
