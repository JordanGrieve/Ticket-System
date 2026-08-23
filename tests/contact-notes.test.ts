import { describe, it, expect } from "vitest";
import {
  MAX_NOTE_LENGTH,
  checkNote,
  normaliseContactEmail,
  describeAuthor,
} from "../lib/contact-notes";

describe("what may be saved as a note", () => {
  it("keeps a normal note and trims it", () => {
    const r = checkNote("  Rang her, collecting Friday.  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toBe("Rang her, collecting Friday.");
  });

  it("rejects whitespace-only, which is what an abandoned textarea yields", () => {
    // A textarea clicked into and out of yields "\n". Saving those quietly is
    // how a notes list fills with blanks and stops being read.
    for (const blank of ["", "   ", "\n", "\t \n "]) {
      expect(checkNote(blank).ok).toBe(false);
    }
  });

  it("measures the length AFTER trimming", () => {
    const body = "x".repeat(MAX_NOTE_LENGTH);
    expect(checkNote(`  ${body}  `).ok).toBe(true);
    expect(checkNote("x".repeat(MAX_NOTE_LENGTH + 1)).ok).toBe(false);
  });
});

describe("which contact a note is filed under", () => {
  it("lower-cases and trims, matching how contacts.email is stored", () => {
    // Without this, "Emma@" and "emma@" are two note lists about one person,
    // and which one you see depends on the capitalisation of whichever email
    // happened to arrive most recently.
    expect(normaliseContactEmail("  Emma@Bakery.COM ")).toBe("emma@bakery.com");
  });

  it("refuses a key it cannot file under", () => {
    // Null writes nothing. A bad key would create an orphan note that no
    // lookup ever returns — worse than refusing, because the person who typed
    // it believes it was saved.
    for (const bad of ["", "   ", "not-an-email", "x".repeat(255) + "@a.com"]) {
      expect(normaliseContactEmail(bad)).toBeNull();
    }
  });
});

describe("attribution", () => {
  it("uses the stored snapshot", () => {
    expect(describeAuthor("emma@bakery.com")).toBe("emma@bakery.com");
  });

  it("never renders an empty author as blank", () => {
    expect(describeAuthor("   ")).toBe("Unknown");
  });
});
