import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import createHints from "./hints";

function makeInsert() {
  return { enter: vi.fn(), exit: vi.fn() };
}

function makeNormal() {
  return {
    isScrollKeyInHints: vi.fn().mockReturnValue(false),
    passFocus: vi.fn(),
    appendKeysForRepeat: vi.fn(),
    disable: vi.fn(),
  };
}

function makeClipboard() {
  return { write: vi.fn() };
}

describe("createHints — genLabels", () => {
  it("generates the correct number of labels", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    expect(hints.genLabels(4)).toHaveLength(4);
    expect(hints.genLabels(8)).toHaveLength(8);
    expect(hints.genLabels(1)).toHaveLength(1);
  });

  it("produces single-character labels when total <= charset size", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    const labels = hints.genLabels(4);
    expect(labels).toEqual(["A", "S", "D", "F"]);
  });

  it("produces two-character labels when total exceeds charset size", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    const labels = hints.genLabels(16);
    expect(labels).toHaveLength(16);
    for (const label of labels) {
      expect(label.length).toBe(2);
    }
  });

  it("produces prefix-free labels (no label is a prefix of another)", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    const labels = hints.genLabels(12);
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        if (i !== j) {
          const li = labels[i]!;
          const lj = labels[j]!;
          expect(lj.startsWith(li)).toBe(false);
        }
      }
    }
  });

  it("produces unique labels", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    const labels = hints.genLabels(14);
    const unique = new Set(labels);
    expect(unique.size).toBe(14);
  });

  it("labels use uppercase characters", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    const labels = hints.genLabels(4);
    for (const label of labels) {
      expect(label).toBe(label.toUpperCase());
    }
  });

  it("returns exactly 0 labels when total is 0", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    expect(hints.genLabels(0)).toHaveLength(0);
  });

  it("generates three-character labels for very large totals", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    const labels = hints.genLabels(65);
    expect(labels).toHaveLength(65);
    const unique = new Set(labels);
    expect(unique.size).toBe(65);
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        if (i !== j) {
          expect(labels[j]!.startsWith(labels[i]!)).toBe(false);
        }
      }
    }
  });

  it("respects a different character set", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("jk");
    const labels = hints.genLabels(2);
    expect(labels).toEqual(["J", "K"]);
  });

  it("switches the charset to digits through the real create() path after setNumeric()", async () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    // create() is what swaps the charset, and it resolves without geometry
    // because the selector matches nothing in jsdom.
    expect(hints.getCharacters()).toBe("asdfgqwertzxcvb");
    hints.setNumeric();
    await hints.create("a.no-such-element", () => {});

    expect(hints.getCharacters()).toBe("1234567890");
    const labels = hints.genLabels(10);
    for (const label of labels) {
      expect(/^[0-9]$/.test(label)).toBe(true);
    }
  });
});

// Single-character sets are excluded because genLabels never satisfies its exit
// condition for them, and characters that collide once uppercased (such as "aA"
// or "ß") would make duplicate labels: both are defects of their own rather than
// of the properties below, which describe usable character sets.
const hintCharset = fc
  .uniqueArray(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), {
    minLength: 2,
    maxLength: 10,
  })
  .map((chars) => chars.join(""));

const hintTotal = fc.nat({ max: 200 });

describe("createHints — genLabels properties", () => {
  // The harness is shared across runs because genLabels only reads the character
  // set that setCharacters assigns, so no state survives one run into the next.
  it("returns exactly as many labels as requested", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    fc.assert(
      fc.property(hintCharset, hintTotal, (charset, total) => {
        hints.setCharacters(charset);
        expect(hints.genLabels(total)).toHaveLength(total);
      }),
    );
  });

  it("never repeats a label", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    fc.assert(
      fc.property(hintCharset, hintTotal, (charset, total) => {
        hints.setCharacters(charset);
        const labels = hints.genLabels(total);
        expect(new Set(labels).size).toBe(labels.length);
      }),
    );
  });

  it("never makes a label that is a proper prefix of another label", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    fc.assert(
      fc.property(hintCharset, hintTotal, (charset, total) => {
        hints.setCharacters(charset);
        // A proper prefix sorts immediately before every string it prefixes, so
        // adjacent pairs of the sorted labels cover all prefix relations.
        let previous: string | undefined;
        for (const label of hints.genLabels(total).toSorted()) {
          if (previous != null) {
            expect(label.startsWith(previous)).toBe(false);
          }
          previous = label;
        }
      }),
    );
  });

  it("draws every label from the uppercased character set and leaves none empty", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    fc.assert(
      fc.property(hintCharset, hintTotal, (charset, total) => {
        hints.setCharacters(charset);
        const upper = charset.toUpperCase();
        for (const label of hints.genLabels(total)) {
          expect(label.length).toBeGreaterThan(0);
          for (const ch of label) {
            expect(upper.includes(ch)).toBe(true);
          }
        }
      }),
    );
  });
});

describe("createHints — getCharacters / setCharacters", () => {
  it("returns the default character set", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    expect(hints.getCharacters()).toBe("asdfgqwertzxcvb");
  });

  it("returns the updated character set after setCharacters", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("jkl");
    expect(hints.getCharacters()).toBe("jkl");
  });

  it("records scroll keys that overlap with the new character set", () => {
    const normal = makeNormal();
    normal.isScrollKeyInHints.mockImplementation((key: string) => key === "j" || key === "k");
    const hints = createHints(makeInsert(), normal, makeClipboard());
    hints.setCharacters("jkl");
    expect(normal.isScrollKeyInHints).toHaveBeenCalledWith("j");
    expect(normal.isScrollKeyInHints).toHaveBeenCalledWith("k");
    expect(normal.isScrollKeyInHints).toHaveBeenCalledWith("l");
  });
});

describe("createHints — getSelector()", () => {
  it("returns an empty string before any create() call", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    expect(hints.getSelector()).toBe("");
  });
});
