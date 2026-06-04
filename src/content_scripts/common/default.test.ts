import { beforeEach, describe, expect, it, vi } from "vitest";

// default.ts wires the built-in key map onto an api/ctx pair. These tests pin
// that contract: which keys are bound, and where each key's action delegates
// (RUNTIME message, front, visual, clipboard, tabOpenLink, search aliases).
// The external seams are mocked so the delegations are observable.
const seam = vi.hoisted(() => {
  const RUNTIME = Object.assign(vi.fn(), { repeats: 1 });
  return {
    RUNTIME,
    dispatchSKEvent: vi.fn(),
    runtimeConf: {
      lastKeys: ["se"],
      textAnchorPat: /x/g,
      clickablePat: /y/g,
      clickableSelector: "",
    },
    utils: {
      getBrowserName: vi.fn(() => "Chrome"),
      getCssSelectorsOfEditable: vi.fn(() => "input"),
      getLargeElements: vi.fn(() => []),
      getTextNodePos: vi.fn(() => ({ top: 0, left: 0 })),
      getWordUnderCursor: vi.fn(() => "word"),
      htmlEncode: vi.fn((s: string) => s),
      regExpReplacer: vi.fn((_k: string, v: unknown) => v),
      removeAttributes: vi.fn(),
      setSanitizedContent: vi.fn(),
      showBanner: vi.fn(),
      showPopup: vi.fn(),
      tabOpenLink: vi.fn(),
      toggleQuote: vi.fn(),
    },
  };
});

vi.mock("./runtime", () => ({
  RUNTIME: seam.RUNTIME,
  dispatchSKEvent: seam.dispatchSKEvent,
  runtime: { conf: seam.runtimeConf },
}));

vi.mock("./utils", () => seam.utils);

import registerDefaultMappings from "./default";

type Registration = {
  mode: string;
  annotation: string | string[];
  cb: (...args: unknown[]) => unknown;
  options: unknown;
};

/** An object whose every property is a lazily-created vi.fn returning a promise. */
function autoMock(): any {
  const cache: Record<string, ReturnType<typeof vi.fn>> = {};
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        cache[prop] ??= vi.fn(() => Promise.resolve(0));
        return cache[prop];
      },
    },
  );
}

let registry: Map<string, Registration>;
let allRegs: Array<Registration & { keys: string }>;
let remaps: unknown[][];
let ctx: any;
let api: any;

beforeEach(() => {
  vi.clearAllMocks();
  registry = new Map();
  allRegs = [];
  remaps = [];
  const record = (mode: string) => (keys: string, annotation: any, cb: any, options: any) => {
    registry.set(keys, { mode, annotation, cb, options });
    allRegs.push({ keys, mode, annotation, cb, options });
  };
  api = {
    mapkey: record("normal"),
    imapkey: record("insert"),
    vmapkey: record("visual"),
    cmap: vi.fn((a: string, b: string) => remaps.push(["cmap", a, b])),
    map: vi.fn((...args: unknown[]) => remaps.push(["map", ...args])),
    addSearchAlias: vi.fn(),
    searchSelectedWith: vi.fn(),
  };
  ctx = {
    clipboard: autoMock(),
    normal: autoMock(),
    hints: autoMock(),
    visual: autoMock(),
    front: autoMock(),
  };
  registerDefaultMappings(api, ctx);
});

const fire = (key: string) => registry.get(key)!.cb();

describe("default mappings registration", () => {
  it("binds a representative set of normal-mode keys", () => {
    for (const key of ["[[", "]]", "T", "?", "i", "f", "v", "m", "'", "r", "x", "t", "b"]) {
      expect(registry.has(key)).toBe(true);
    }
  });

  it("records the feature-group annotation verbatim", () => {
    expect(registry.get("T")!.annotation).toBe("#3Choose a tab");
    expect(registry.get("x")!.annotation).toBe("#3Close current tab");
  });

  it("binds Toggle-quotes to <Ctrl-'> in insert mode", () => {
    const insertBinding = allRegs.find((r) => r.keys === "<Ctrl-'>" && r.mode === "insert");
    expect(insertBinding).toBeDefined();
    expect(insertBinding!.annotation).toBe("#14Toggle quotes in an input element");
  });
});

describe("RUNTIME-delegating keys", () => {
  const cases: Array<[string, string, unknown?]> = [
    ["zr", "setZoom", { zoomFactor: 0 }],
    ["zi", "setZoom", { zoomFactor: 0.1 }],
    ["zo", "setZoom", { zoomFactor: -0.1 }],
    ["ZZ", "createSession", { name: "LAST", quitAfterSaved: true }],
    ["ZR", "openSession", { name: "LAST" }],
    ["<Alt-p>", "togglePinTab"],
    ["<Alt-m>", "muteTab"],
    ["B", "historyTab", { backward: true }],
    ["F", "historyTab", { backward: false }],
    ["<Ctrl-6>", "goToLastTab"],
    ["gT", "historyTab", { index: 0 }],
    ["gt", "historyTab", { index: -1 }],
    ["r", "reloadTab", { nocache: false }],
    ["x", "closeTab"],
    ["yt", "duplicateTab"],
    ["yT", "duplicateTab", { active: false }],
    ["X", "openLast"],
    ["gs", "viewSource", { tab: { tabbed: true } }],
    ["<<", "moveTab", { step: -1 }],
    [">>", "moveTab", { step: 1 }],
    ["gxx", "tabOnly"],
    [";gw", "gatherWindows"],
    ["gxt", "closeTabLeft"],
    ["gxT", "closeTabRight"],
    ["gx0", "closeTabsToLeft"],
    ["gx$", "closeTabsToRight"],
    ["gxp", "closeAudibleTab"],
    [";cq", "clearQueueURLs"],
    [";j", "closeDownloadsShelf", { clearHistory: true }],
    [";dh", "deleteHistoryOlderThan", { days: 30 }],
    [";db", "removeBookmark"],
  ];

  it.each(cases)("%s sends the %s message", (key, subject, arg) => {
    fire(key);
    if (arg === undefined) {
      expect(seam.RUNTIME).toHaveBeenLastCalledWith(subject);
    } else {
      expect(seam.RUNTIME).toHaveBeenLastCalledWith(subject, arg);
    }
  });
});

describe("front-delegating keys", () => {
  it("T opens the tab chooser", () => {
    fire("T");
    expect(ctx.front.chooseTab).toHaveBeenCalled();
  });

  it("? shows usage", () => {
    fire("?");
    expect(ctx.front.showUsage).toHaveBeenCalled();
  });

  const omnibar: Array<[string, unknown]> = [
    ["H", { type: "TabURLs" }],
    ["om", { type: "VIMarks" }],
    [":", { type: "Commands" }],
    ["t", { type: "URLs" }],
    ["go", { type: "URLs", tabbed: false }],
    ["b", { type: "Bookmarks" }],
    ["oh", { type: "History" }],
    ["W", { type: "Windows" }],
    ["ox", { type: "RecentlyClosed" }],
    [";x", { type: "CloseTabs" }],
    [";gt", { type: "Tabs", extra: { action: "gather" } }],
  ];

  it.each(omnibar)("%s opens the omnibar with the right type", (key, arg) => {
    fire(key);
    expect(ctx.front.openOmnibar).toHaveBeenLastCalledWith(arg);
  });
});

describe("visual-delegating keys", () => {
  it("V restores visual mode", () => {
    fire("V");
    expect(ctx.visual.restore).toHaveBeenCalled();
  });

  it("* stars the selection then toggles visual mode", () => {
    fire("*");
    expect(ctx.visual.star).toHaveBeenCalled();
    expect(ctx.visual.toggle).toHaveBeenCalled();
  });

  it("n advances to the next match forward", () => {
    fire("n");
    expect(ctx.visual.next).toHaveBeenLastCalledWith(false);
  });

  it("N advances to the next match backward", () => {
    fire("N");
    expect(ctx.visual.next).toHaveBeenLastCalledWith(true);
  });

  it("zv toggles visual mode onto a whole element", () => {
    fire("zv");
    expect(ctx.visual.toggle).toHaveBeenLastCalledWith("z");
  });
});

describe("clipboard-writing keys", () => {
  it("yy copies the full page URL", () => {
    fire("yy");
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith(window.location.href);
  });

  it("yh copies only the host", () => {
    fire("yh");
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith(window.location.host);
  });

  it("yl copies the document title", () => {
    document.title = "A Test Page";
    fire("yl");
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("A Test Page");
  });

  it("ys copies the page source as outer HTML", () => {
    fire("ys");
    const written = ctx.clipboard.write.mock.calls.at(-1)![0];
    expect(written).toContain("<html");
  });
});

describe("tabOpenLink keys (Chrome)", () => {
  it.each([
    ["on", "chrome://newtab/"],
    ["ga", "chrome://help/"],
    ["gb", "chrome://bookmarks/"],
    ["gc", "chrome://cache/"],
    ["gd", "chrome://downloads/"],
    ["gh", "chrome://history/"],
    ["gk", "chrome://settings/cookies"],
    ["ge", "chrome://extensions/"],
    [";i", "chrome://inspect/#devices"],
    [";e", "/options.html"],
  ])("%s opens %s", (key, url) => {
    fire(key);
    expect(seam.utils.tabOpenLink).toHaveBeenLastCalledWith(url);
  });
});

describe("RUNTIME keys that pass a response handler", () => {
  // These call RUNTIME(subject, arg, responseCallback); the mock never invokes
  // the callback, so we assert only the outgoing message (subject + arg).
  const cases: Array<[string, string, unknown]> = [
    ["yj", "getSettings", { key: "RAW" }],
    ["yY", "getTabs", null],
    ["yQ", "getSettings", { key: "OmniQueryHistory" }],
    ["gp", "getTabs", { queryInfo: { audible: true } }],
    ["yd", "getDownloads", { query: { state: "in_progress" } }],
    [";yh", "getHistory", {}],
  ];

  it.each(cases)("%s sends %s with the expected payload", (key, subject, arg) => {
    fire(key);
    expect(seam.RUNTIME.mock.lastCall!.slice(0, 2)).toEqual([subject, arg]);
  });
});

describe("history navigation keys", () => {
  it("S goes one entry back", () => {
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    fire("S");
    expect(go).toHaveBeenLastCalledWith(-1);
    go.mockRestore();
  });

  it("D goes one entry forward", () => {
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    fire("D");
    expect(go).toHaveBeenLastCalledWith(1);
    go.mockRestore();
  });
});

describe("directly-wired keys reference the mode method", () => {
  it("[[ and ]] are bound straight to the page-nav helpers", () => {
    expect(registry.get("[[")!.cb).toBe(ctx.hints.previousPage);
    expect(registry.get("]]")!.cb).toBe(ctx.hints.nextPage);
  });

  it("m and ' are bound straight to the VIMark helpers", () => {
    expect(registry.get("m")!.cb).toBe(ctx.normal.addVIMark);
    expect(registry.get("'")!.cb).toBe(ctx.normal.jumpVIMark);
  });
});

describe("hint-yank keys copy the picked element's text", () => {
  // Each fires the mapping, captures the per-hint callback passed to
  // hints.create, then drives it with a stand-in element to assert what the
  // callback writes to the clipboard.
  const lastHintCallback = () => {
    const calls = ctx.hints.create.mock.calls;
    return calls[calls.length - 1][1] as (el: any) => void;
  };

  it("ya copies a link's href", () => {
    fire("ya");
    lastHintCallback()({ href: "https://example.com/page" });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("https://example.com/page");
  });

  it("yi copies an input's value", () => {
    fire("yi");
    lastHintCallback()({ value: "typed text" });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("typed text");
  });

  it("yq copies a pre element's text", () => {
    fire("yq");
    lastHintCallback()({ innerText: "code block" });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("code block");
  });
});

describe("search aliases", () => {
  it("registers the built-in engines", () => {
    const aliases = api.addSearchAlias.mock.calls.map((c: unknown[]) => c[0]);
    expect(aliases).toEqual(["g", "d", "b", "e", "w", "s", "h", "y"]);
  });

  it("wires Google to its search URL", () => {
    const google = api.addSearchAlias.mock.calls.find((c: unknown[]) => c[0] === "g");
    expect(google[1]).toBe("google");
    expect(google[2]).toBe("https://www.google.com/search?q=");
  });

  it("Google's suggestion parser extracts the completion list", () => {
    const google = api.addSearchAlias.mock.calls.find((c: unknown[]) => c[0] === "g");
    const parse = google[5];
    expect(parse({ text: '["query",["alpha","beta"]]' })).toEqual(["alpha", "beta"]);
  });
});

describe("remaps", () => {
  it("maps g0/g$ to tab edges and remaps arrow keys in command mode", () => {
    expect(remaps).toContainEqual(["map", "g0", ":feedkeys 99E", 0, "#3Go to the first tab"]);
    expect(remaps).toContainEqual(["cmap", "<ArrowDown>", "<Ctrl-n>"]);
  });
});
