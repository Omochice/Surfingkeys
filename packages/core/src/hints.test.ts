import { Result } from "@praha/byethrow";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineEnv } from "./engineEnv";
import createHints from "./hints";
import { getCurrentMode, initModeHub, releaseBufferedKeyEvents } from "./mode";

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

// A character set is usable as long as its characters stay distinct once uppercased, so the pool
// draws unique characters and then raises an arbitrary subset of them.
const hintCharset = fc
  .uniqueArray(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), {
    minLength: 2,
    maxLength: 10,
  })
  .chain((chars) =>
    fc
      .array(fc.boolean(), { minLength: chars.length, maxLength: chars.length })
      .map((raised) => chars.map((c, at) => (raised[at] ? c.toUpperCase() : c)).join("")),
  );

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

  it.each(["", "a", "aA", "Aa", "abcA", "ß", "aß"])(
    "rejects %o, which cannot label more than one hint apiece",
    (chars) => {
      const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
      expect(() => hints.setCharacters(chars)).toThrow(RangeError);
    },
  );

  it("keeps the previous character set after a rejected one", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("jkl");
    expect(() => hints.setCharacters("a")).toThrow(RangeError);
    expect(hints.getCharacters()).toBe("jkl");
  });

  it("accepts a mixed-case set whose characters stay distinct once uppercased", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    hints.setCharacters("aB");
    expect(hints.getCharacters()).toBe("aB");
  });
});

describe("createHints — setCharacters over arbitrary strings", () => {
  // Every string a user config can pass goes through here, and a set genLabels cannot work with
  // has to be turned away before it is stored, because genLabels grows its labels in a loop that
  // no vitest timeout can interrupt.
  it("either rejects a character set or generates that many distinct labels from it", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), hintTotal, (charset, total) => {
        try {
          hints.setCharacters(charset);
        } catch (error) {
          expect(error).toBeInstanceOf(RangeError);
          return;
        }
        const labels = hints.genLabels(total);
        expect(labels).toHaveLength(total);
        expect(new Set(labels).size).toBe(total);
      }),
    );
  });
});

describe("createHints — getSelector()", () => {
  it("returns an empty string before any create() call", () => {
    const hints = createHints(makeInsert(), makeNormal(), makeClipboard());
    expect(hints.getSelector()).toBe("");
  });
});

function makeEngineEnv(): EngineEnv {
  return {
    RUNTIME: () => Result.succeed(undefined),
    isInUIFrame: () => false,
    reportIssue: vi.fn(),
    tabOpenLink: () => {},
    getExtensionURL: (path: string) => path,
    log: () => {},
    surfingkeys: undefined,
  };
}

// jsdom lays nothing out, so the target carries the geometry filterInvisibleElements reads.
function makeHintTarget(): HTMLElement {
  const element = document.createElement("a");
  document.body.append(element);
  Object.defineProperty(element, "offsetWidth", { value: 50, configurable: true });
  Object.defineProperty(element, "offsetHeight", { value: 20, configurable: true });
  element.getBoundingClientRect = () => new DOMRect(10, 10, 50, 20);
  return element;
}

describe("createHints — scroll keys while hints are shown", () => {
  // The mode hub's stack and listeners are module-level, so they carry over between tests.
  beforeEach(() => {
    initModeHub(makeEngineEnv());
    releaseBufferedKeyEvents();
  });

  // Only the Esc teardown detaches the host; exiting the mode leaves it on the document.
  afterEach(() => {
    pressKey("<Esc>");
    document.body.replaceChildren();
  });

  function makeScrollingNormal() {
    const normal = makeNormal();
    normal.isScrollKeyInHints.mockImplementation((key: string) => key === "j");
    return normal;
  }

  async function showHints(hints: ReturnType<typeof createHints>): Promise<void> {
    const found = await hints.create([makeHintTarget(), makeHintTarget()], () => {});
    expect(found).toBe(2);
    expect(getCurrentMode()?.name).toBe("Hints");
  }

  function pressKey(key: string): { sk_stopPropagation?: boolean } {
    const event = new Event("keydown") as Event & {
      sk_keyName?: string;
      sk_stopPropagation?: boolean;
    };
    event.sk_keyName = key;
    window.dispatchEvent(event);
    return event;
  }

  function hintHosts(): NodeListOf<Element> {
    return document.querySelectorAll(".surfingkeys_hints_host");
  }

  it("takes the hints off the document and leaves hints mode on Esc", async () => {
    const hints = createHints(makeInsert(), makeScrollingNormal(), makeClipboard());
    hints.setCharacters("asdf");
    await showHints(hints);
    expect(hintHosts()).toHaveLength(1);

    pressKey("<Esc>");

    expect(hintHosts()).toHaveLength(0);
    expect(getCurrentMode()).toBeUndefined();
  });

  it("hands a scroll key outside the character set to normal mode", async () => {
    const hints = createHints(makeInsert(), makeScrollingNormal(), makeClipboard());
    hints.setCharacters("asdf");
    await showHints(hints);

    expect(pressKey("j").sk_stopPropagation).toBe(false);
  });

  it("hands a scroll key on to normal mode once it leaves the character set", async () => {
    const hints = createHints(makeInsert(), makeScrollingNormal(), makeClipboard());
    hints.setCharacters("jkl");
    hints.setCharacters("asdf");
    await showHints(hints);

    expect(pressKey("j").sk_stopPropagation).toBe(false);
  });

  it("keeps a scroll key that is a hint character from scrolling the page", async () => {
    const hints = createHints(makeInsert(), makeScrollingNormal(), makeClipboard());
    hints.setCharacters("jkl");
    await showHints(hints);

    expect(pressKey("j").sk_stopPropagation).toBe(true);
  });
});
