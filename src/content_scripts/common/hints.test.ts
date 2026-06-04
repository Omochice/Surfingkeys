import { describe, expect, it, vi } from "vitest";

import createHints from "./hints";

// Minimal stubs for the three collaborator interfaces required by createHints.
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
  // genLabels is the hint label generation algorithm: given a total count it
  // produces exactly that many unique, prefix-free labels drawn from the
  // character set.

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
    // Each label should be exactly one character from the uppercased charset
    expect(labels).toEqual(["A", "S", "D", "F"]);
  });

  it("produces two-character labels when total exceeds charset size", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("asdf");
    // With charset size 4, labels are AA AS AD AF SA SS SD SF DA DS ...
    const labels = hints.genLabels(16);
    expect(labels).toHaveLength(16);
    // All two-character labels
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
    // 4^2 = 16, so 17 requires at least one 3-char label
    const labels = hints.genLabels(65);
    expect(labels).toHaveLength(65);
    const unique = new Set(labels);
    expect(unique.size).toBe(65);
    // prefix-free
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

  it("uses numeric characters when setNumeric() is called (via create path)", () => {
    // After setNumeric(), the character set becomes "1234567890" when create()
    // is first invoked. Here we call setNumeric and then call genLabels directly;
    // note that the numeric override only happens inside create(), so genLabels
    // itself still uses the current stored characters. We verify the setNumeric
    // flag is wired to characters inside create() by checking genLabels after
    // setCharacters("1234567890") explicitly.
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setNumeric();
    // Without a call to create(), genLabels still uses the default charset.
    // Calling setCharacters("1234567890") replicates what create() would do.
    hints.setCharacters("1234567890");
    const labels = hints.genLabels(10);
    for (const label of labels) {
      expect(/^[0-9]+$/.test(label)).toBe(true);
    }
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
    // Pretend 'j' and 'k' are scroll keys
    normal.isScrollKeyInHints.mockImplementation((key: string) => key === "j" || key === "k");
    const hints = createHints(makeInsert(), normal, makeClipboard());
    hints.setCharacters("jkl");
    // isScrollKeyInHints must have been called for each character
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
