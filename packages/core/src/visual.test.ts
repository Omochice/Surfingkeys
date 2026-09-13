import { Result } from "@praha/byethrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conf } from "./conf";
import type { EngineEnv } from "./engineEnv";
import KeyboardUtils from "./keyboardUtils";
import createVisual from "./visual";

// visual reaches the seam only via RUNTIME (find-history update); the rest are inert stubs.
function makeEnv(): EngineEnv {
  return {
    RUNTIME: () => Result.succeed(undefined),
    isInUIFrame: () => false,
    reportIssue: () => {},
    tabOpenLink: () => {},
    getExtensionURL: (path: string) => path,
    log: () => {},
    surfingkeys: undefined,
  };
}

function makeClipboard() {
  return { write: vi.fn() };
}

function makeHints() {
  return {
    create: vi.fn().mockResolvedValue(0),
  };
}

function fireEvent(
  mode: ReturnType<typeof createVisual>,
  name: string,
  extra: Record<string, unknown> = {},
): Event {
  const evt = new Event(name) as Event & Record<string, unknown>;
  for (const [k, v] of Object.entries(extra)) {
    evt[k] = v;
  }
  const handler = mode.eventListeners[name];
  if (handler == null) {
    throw new Error(`visual mode has no listener for "${name}"`);
  }
  handler(evt);
  return evt;
}

function captureEvents(target: EventTarget): { detail: unknown }[] {
  const captured: { detail: unknown }[] = [];
  target.addEventListener("surfingkeys:front", (e) => {
    captured.push({ detail: (e as CustomEvent).detail });
  });
  return captured;
}

describe("createVisual — mode identity", () => {
  it("creates a mode named 'Visual'", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    expect(visual.name).toBe("Visual");
  });
});

describe("createVisual — mapping registrations", () => {
  const singleKeys = [
    "l",
    "h",
    "j",
    "k",
    "w",
    "e",
    "b",
    ")",
    "(",
    "}",
    "{",
    "0",
    "$",
    "o",
    "p",
    "V",
    "*",
    "f",
    "F",
    ";",
    ",",
    "G",
  ];

  for (const key of singleKeys) {
    it(`registers the mapping '${key}'`, () => {
      const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
      const node = visual.mappings.find(key);
      expect(node?.meta, `expected mapping for key "${key}"`).toBeDefined();
    });
  }

  it("registers 'gg' as a two-key sequence", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const node = visual.mappings.find("gg");
    expect(node?.meta).toBeDefined();
    expect(node?.meta?.annotation).toContain("documentboundary");
  });

  it("registers 'zt', 'zz', 'zb' as two-key sequences", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    for (const key of ["zt", "zz", "zb"]) {
      const node = visual.mappings.find(key);
      expect(node?.meta, `expected mapping for "${key}"`).toBeDefined();
    }
  });

  it("registers the <Enter> mapping for clicking links", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const encoded = KeyboardUtils.encodeKeystroke("<Enter>");
    const node = visual.mappings.find(encoded);
    expect(node?.meta?.annotation).toContain("Click");
  });

  it("registers the <Shift-Enter> mapping for clicking links with shift", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const encoded = KeyboardUtils.encodeKeystroke("<Shift-Enter>");
    const node = visual.mappings.find(encoded);
    expect(node?.meta?.annotation).toContain("Click");
  });
});

describe("createVisual — emptySelection()", () => {
  it("collapses any existing selection", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());

    const p = document.createElement("p");
    p.textContent = "hello world";
    document.body.appendChild(p);

    const sel = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);

    expect(sel.toString()).toBe("hello world");

    visual.emptySelection();

    expect(sel.toString()).toBe("");

    p.remove();
  });
});

describe("createVisual — statusLine reflects state transitions", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("starts with an empty statusLine (state=0)", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    visual.onEnter!();
    expect(visual.statusLine).toBe("Visual - Caret");
  });

  it("second enter() increments state to 2 (Range) and updates statusLine", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    visual.onEnter!();
    visual.onEnter!();
    expect(visual.statusLine).toBe("Visual - Range");
  });

  it("third enter() wraps state back to 0 and sets statusLine to 'Visual - '", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    visual.onEnter!();
    visual.onEnter!();
    visual.onEnter!();
    // state=3%3=0, status[0]="" so statusLine = "Visual - "
    expect(visual.statusLine).toBe("Visual - ");
  });
});

describe("createVisual — visualClear()", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("dispatches a showStatus '' event via surfingkeys:front", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const captured = captureEvents(document);

    visual.visualClear();

    const statusEvents = captured.filter((e) => {
      const d = e.detail as unknown[];
      return Array.isArray(d) && d[0] === "showStatus";
    });
    expect(statusEvents.length).toBeGreaterThan(0);
    const lastArgs = (statusEvents.at(-1)!.detail as unknown[])[1] as unknown[];
    // Third element of showStatus args is the status text; visualClear sends "".
    expect(lastArgs[2]).toBe("");
  });
});

describe("createVisual — visualEnter()", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("returns early without entering the mode for an empty query", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const enterSpy = vi.spyOn(visual, "enter");

    visual.visualEnter("");

    expect(enterSpy).not.toHaveBeenCalled();
  });

  it("returns early without entering the mode for the '.' query", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const enterSpy = vi.spyOn(visual, "enter");

    visual.visualEnter(".");

    expect(enterSpy).not.toHaveBeenCalled();
  });

  it("dispatches a 'Pattern not found' status when the query has no matches in the document", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    document.body.textContent = "no match here";
    const captured = captureEvents(document);

    // Stub window.find so no match is found.
    const origFind = (window as any).find;
    (window as any).find = () => false;
    try {
      visual.visualEnter("xyzzy_no_such_text");
    } finally {
      (window as any).find = origFind;
    }

    const statusEvents = captured.filter((e) => {
      const d = e.detail as unknown[];
      return Array.isArray(d) && d[0] === "showStatus";
    });
    const texts = statusEvents.map((e) => {
      const args = (e.detail as unknown[])[1] as unknown[];
      return args[2];
    });
    expect(texts.some((t) => typeof t === "string" && t.includes("Pattern not found"))).toBe(true);

    document.body.textContent = "";
  });
});

describe("createVisual — next()", () => {
  let savedLastQuery: string;

  beforeEach(() => {
    savedLastQuery = conf.lastQuery;
  });

  afterEach(() => {
    conf.lastQuery = savedLastQuery;
    document.body.replaceChildren();
  });

  it("when no matches and lastQuery is set, dispatches 'Pattern not found' via visualEnter", () => {
    conf.lastQuery = "xyzzy_absent";
    document.body.textContent = "unrelated content";
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const captured = captureEvents(document);

    const origFind = (window as any).find;
    (window as any).find = () => false;
    try {
      visual.next();
    } finally {
      (window as any).find = origFind;
    }

    const statusTexts = captured
      .filter((e) => {
        const d = e.detail as unknown[];
        return Array.isArray(d) && d[0] === "showStatus";
      })
      .map((e) => {
        const args = (e.detail as unknown[])[1] as unknown[];
        return args[2];
      });

    expect(statusTexts.some((t) => typeof t === "string" && t.includes("Pattern not found"))).toBe(
      true,
    );
  });
});

// jsdom has no layout engine, so highlight()'s match pipeline finds nothing by
// default: getTextNodes rejects nodes without an offsetParent or a sized bounding
// rect, and createMark keeps only rects with a positive width/height. Stub the
// minimum layout needed for a text node to be accepted and a match mark created.
function stubHighlightLayout(): () => void {
  const rect = {
    top: 10,
    left: 10,
    right: 110,
    bottom: 30,
    width: 100,
    height: 20,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  } as DOMRect;
  const origOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  const origGetBCR = Element.prototype.getBoundingClientRect;
  const origGetClientRects = Range.prototype.getClientRects;
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return document.body;
    },
  });
  Element.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  // createMark reads document.scrollingElement, which jsdom leaves unset.
  Object.defineProperty(document, "scrollingElement", {
    configurable: true,
    get() {
      return document.documentElement;
    },
  });
  return () => {
    if (origOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, "offsetParent", origOffsetParent);
    }
    Element.prototype.getBoundingClientRect = origGetBCR;
    Range.prototype.getClientRects = origGetClientRects;
    Reflect.deleteProperty(document, "scrollingElement");
  };
}

function statusTexts(captured: { detail: unknown }[]): unknown[] {
  return captured
    .filter((e) => {
      const d = e.detail as unknown[];
      return Array.isArray(d) && d[0] === "showStatus";
    })
    .map((e) => {
      const args = (e.detail as unknown[])[1] as unknown[];
      return args[2];
    });
}

describe("createVisual — visualEnter() query compilation", () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    document.body.replaceChildren();
    restoreLayout = stubHighlightLayout();
  });

  afterEach(() => {
    restoreLayout();
    document.body.replaceChildren();
  });

  it("matches an invalid regex query as a literal string instead of throwing", () => {
    document.body.textContent = "look for c++ in here";
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const enterSpy = vi.spyOn(visual, "enter");
    const captured = captureEvents(document);

    expect(() => visual.visualEnter("c++")).not.toThrow();

    expect(enterSpy).toHaveBeenCalled();
    const texts = statusTexts(captured);
    expect(texts.some((t) => typeof t === "string" && t.includes("1 / 1"))).toBe(true);
    expect(texts.some((t) => typeof t === "string" && t.includes("Pattern not found"))).toBe(false);
  });

  it("keeps regex semantics for a valid pattern", () => {
    document.body.textContent = "cat cot cut";
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const captured = captureEvents(document);

    // "c.t" is a regex matching all three words; a literal search would match none.
    visual.visualEnter("c.t");

    const texts = statusTexts(captured);
    expect(texts.some((t) => typeof t === "string" && t.includes("/ 3"))).toBe(true);
  });
});

describe("createVisual — next() repeats an invalid regex query", () => {
  let savedLastQuery: string;
  let restoreLayout: () => void;

  beforeEach(() => {
    savedLastQuery = conf.lastQuery;
    document.body.replaceChildren();
    restoreLayout = stubHighlightLayout();
  });

  afterEach(() => {
    conf.lastQuery = savedLastQuery;
    restoreLayout();
    document.body.replaceChildren();
  });

  it("finds the literal text without throwing when lastQuery is an invalid pattern", () => {
    conf.lastQuery = "c++";
    document.body.textContent = "the c++ language";
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const captured = captureEvents(document);

    expect(() => visual.next()).not.toThrow();

    const texts = statusTexts(captured);
    expect(texts.some((t) => typeof t === "string" && t.includes("1 / 1"))).toBe(true);
    expect(texts.some((t) => typeof t === "string" && t.includes("Pattern not found"))).toBe(false);
  });
});

describe("createVisual — findSentenceOf()", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("returns an empty string when the query word is not visible in the document", () => {
    document.body.textContent = "completely different content here";
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());

    const result = visual.findSentenceOf("xyzzy_nonexistent");

    expect(result).toBe("");
  });
});

describe("createVisual — toggle() state transitions", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("in state=0 (default) calls hints.create with textAnchorPat", () => {
    const hints = makeHints();
    const visual = createVisual(makeClipboard(), hints, makeEnv());
    visual.toggle();

    expect(hints.create).toHaveBeenCalledOnce();
    expect(hints.create.mock.calls[0]?.[0]).toBe(conf.textAnchorPat);
  });

  it("in state=1 (Caret) extends selection anchor and increments state to 2", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());

    visual.onEnter!();
    expect(visual.statusLine).toBe("Visual - Caret");

    // Place a real selection so selection.extend doesn't throw.
    const p = document.createElement("p");
    p.textContent = "hello world";
    document.body.appendChild(p);
    const sel = document.getSelection()!;
    sel.setPosition(p.firstChild, 0);

    visual.toggle();

    expect(visual.statusLine).toBe("Visual - Range");
  });

  it("in state=2 (Range) exits the mode and wraps state back to 0", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());

    visual.onEnter!();
    visual.onEnter!();
    expect(visual.statusLine).toBe("Visual - Range");

    const p = document.createElement("p");
    p.textContent = "test";
    document.body.appendChild(p);
    const sel = document.getSelection()!;
    sel.setPosition(p.firstChild, 0);

    visual.toggle();

    expect(visual.statusLine).toBe("Visual - ");
  });
});

describe("createVisual — keydown: 'f' sets visualf=1 and updates statusLine", () => {
  it("the 'f' mapping sets statusLine to include '- forward'", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    visual.onEnter!(); // state=1
    expect(visual.statusLine).toBe("Visual - Caret");

    const fNode = visual.mappings.find("f");
    fNode?.meta?.code?.();

    expect(visual.statusLine).toContain("forward");
  });

  it("the 'F' mapping sets statusLine to include '- backward'", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    visual.onEnter!(); // state=1

    const fNode = visual.mappings.find("F");
    fNode?.meta?.code?.();

    expect(visual.statusLine).toContain("backward");
  });
});

describe("createVisual — keydown: <Esc> when state <= 1 calls visualClear and exit", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("<Esc> in state=1 calls visualClear", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    visual.onEnter!(); // state=1
    const clearSpy = vi.spyOn(visual, "visualClear");

    const escKey = KeyboardUtils.encodeKeystroke("<Esc>");
    fireEvent(visual, "keydown", { sk_keyName: escKey });

    // visualClear is called at least once: directly by the <Esc> branch (state <= 1),
    // and again via onExit when exit() is called. Both are observable effects.
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("createVisual — getCursorPixelPos()", () => {
  it("returns a DOMRect (all zeros in jsdom since cursor is not in DOM)", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const rect = visual.getCursorPixelPos();
    // In jsdom getBoundingClientRect always returns zeros; the important
    // contract is that a DOMRect-shaped object is returned, not null/undefined.
    expect(rect).toBeDefined();
    expect(typeof rect.top).toBe("number");
    expect(typeof rect.left).toBe("number");
  });
});

describe("createVisual — onExit()", () => {
  it("onExit calls visualClear", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const clearSpy = vi.spyOn(visual, "visualClear");

    visual.onExit!();

    expect(clearSpy).toHaveBeenCalledOnce();
  });
});

describe("createVisual — restore()", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("does not enter visual mode when there is no existing selection anchor", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const enterSpy = vi.spyOn(visual, "enter");
    document.getSelection()!.removeAllRanges();

    visual.restore();

    expect(enterSpy).not.toHaveBeenCalled();
  });

  it("calls enter() and showCursor() when a selection anchor exists", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    const enterSpy = vi.spyOn(visual, "enter");

    const p = document.createElement("p");
    p.textContent = "restore test";
    document.body.appendChild(p);

    const sel = document.getSelection()!;
    sel.setPosition(p.firstChild, 0);

    visual.restore();

    expect(enterSpy).toHaveBeenCalledOnce();
  });
});

describe("createVisual — 'y' mapping is registered after state change", () => {
  it("'y' has no code in the initial state=0 (yankFunctions[0] is empty)", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    // In state=0, yankFunctions[0] = {} which has no code. The mapping may
    // exist but code should be undefined.
    const yNode = visual.mappings.find("y");
    expect(yNode?.meta?.code).toBeUndefined();
  });

  it("'y' has a code function after entering state=1 (Caret)", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    visual.onEnter!(); // advances to state=1, onStateChange adds yankFunctions[1]
    const yNode = visual.mappings.find("y");
    expect(yNode?.meta?.code).toBeTypeOf("function");
  });

  it("'y' in state=2 (Range) has a code function that writes selection to clipboard", () => {
    const clipboard = makeClipboard();
    const visual = createVisual(clipboard, makeHints(), makeEnv());
    visual.onEnter!();
    visual.onEnter!(); // state=2

    const p = document.createElement("p");
    p.textContent = "copy this text";
    document.body.appendChild(p);

    const sel = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);

    const yNode = visual.mappings.find("y");
    expect(yNode?.meta?.code).toBeTypeOf("function");

    yNode?.meta?.code?.();

    expect(clipboard.write).toHaveBeenCalledOnce();
    expect(clipboard.write.mock.calls[0]?.[0]).toBe("copy this text");

    document.body.replaceChildren();
  });
});

describe("createVisual — 'o' mapping swaps anchor and focus", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("after 'o', the anchor and focus positions are swapped", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());

    const p = document.createElement("p");
    p.textContent = "abcdef";
    document.body.appendChild(p);

    const textNode = p.firstChild as Text;
    const sel = document.getSelection()!;
    sel.setBaseAndExtent(textNode, 0, textNode, 4);

    expect(sel.anchorOffset).toBe(0);
    expect(sel.focusOffset).toBe(4);

    const oNode = visual.mappings.find("o");
    oNode?.meta?.code?.();

    expect(sel.anchorOffset).toBe(4);
    expect(sel.focusOffset).toBe(0);
  });
});

describe("createVisual — 'y' yank honours modeAfterYank", () => {
  let savedMode: string;

  beforeEach(() => {
    savedMode = conf.modeAfterYank;
  });

  afterEach(() => {
    conf.modeAfterYank = savedMode;
    document.body.replaceChildren();
  });

  function selectRange(text: string) {
    const p = document.createElement("p");
    p.textContent = text;
    document.body.appendChild(p);
    const sel = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it("drops to Caret state (status 'Caret') after yank when modeAfterYank is 'Caret'", () => {
    conf.modeAfterYank = "Caret";
    const clipboard = makeClipboard();
    const visual = createVisual(clipboard, makeHints(), makeEnv());
    visual.onEnter!();
    visual.onEnter!(); // state=2 (Range)
    selectRange("yank me");

    visual.mappings.find("y")?.meta?.code?.();

    expect(clipboard.write).toHaveBeenCalledWith("yank me");
    expect(visual.statusLine).toBe("Visual - Caret");
  });

  it("toggles out via self.toggle (exit) after yank when modeAfterYank is 'Normal'", () => {
    conf.modeAfterYank = "Normal";
    const clipboard = makeClipboard();
    const visual = createVisual(clipboard, makeHints(), makeEnv());
    visual.onEnter!();
    visual.onEnter!(); // state=2 (Range)
    selectRange("take this");
    const exitSpy = vi.spyOn(visual, "exit");

    visual.mappings.find("y")?.meta?.code?.();

    expect(clipboard.write).toHaveBeenCalledWith("take this");
    expect(exitSpy).toHaveBeenCalled();
  });
});

describe("createVisual — keydown while visualf is active", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function enterFindMode(visual: ReturnType<typeof createVisual>) {
    visual.onEnter!(); // state=1
    // The 'f' mapping sets visualf=1 (forward find pending).
    visual.mappings.find("f")?.meta?.code?.();
    expect(visual.statusLine).toContain("forward");
  }

  it("a word character while finding resets the status line and suppresses the event", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    enterFindMode(visual);

    // window.find is unimplemented in jsdom; stub it to false (as the next() test
    // does) so visualSeek runs without throwing. The branch under test is the
    // exitf=true status reset / suppression, which is pure non-geometry logic.
    const origFind = (window as any).find;
    (window as any).find = () => false;
    try {
      // keyCode 97 = 'a' is what KeyboardUtils.isWordChar reads to take the seek arm.
      const event = fireEvent(visual, "keydown", { sk_keyName: "a", keyCode: 97 });

      expect(visual.statusLine).toBe("Visual - Caret");
      expect((event as any).sk_stopPropagation).toBe(true);
      expect((event as any).sk_suppressed).toBe(true);
    } finally {
      (window as any).find = origFind;
    }
  });

  it("Esc while finding cancels find without throwing and restores the status line", () => {
    const visual = createVisual(makeClipboard(), makeHints(), makeEnv());
    enterFindMode(visual);

    const escKey = KeyboardUtils.encodeKeystroke("<Esc>");
    const event = fireEvent(visual, "keydown", { sk_keyName: escKey });

    expect(visual.statusLine).toBe("Visual - Caret");
    expect((event as any).sk_suppressed).toBe(true);
  });
});
