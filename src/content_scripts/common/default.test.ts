import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("more mode delegations", () => {
  it("Q opens the omniquery for the word under the cursor", () => {
    fire("Q");
    expect(ctx.front.openOmniquery).toHaveBeenCalled();
  });

  it("gi opens the input hint layer", () => {
    fire("gi");
    expect(ctx.hints.createInputLayer).toHaveBeenCalled();
  });

  it(";m mouses out the last element", () => {
    fire(";m");
    expect(ctx.hints.mouseoutLastElement).toHaveBeenCalled();
  });

  it("v toggles visual mode", () => {
    fire("v");
    expect(ctx.visual.toggle).toHaveBeenCalled();
  });

  it("i creates hints over editable elements wired to the click dispatcher", () => {
    fire("i");
    expect(ctx.hints.create).toHaveBeenLastCalledWith("input", ctx.hints.dispatchMouseClick);
  });

  it("q creates hints over images and buttons", () => {
    fire("q");
    expect(ctx.hints.create).toHaveBeenLastCalledWith("img, button", ctx.hints.dispatchMouseClick);
  });

  it("oi opens an incognito window for the current URL", () => {
    fire("oi");
    expect(seam.RUNTIME).toHaveBeenLastCalledWith("openIncognito", { url: window.location.href });
  });

  it("af opens a link in an active new tab", () => {
    fire("af");
    expect(ctx.hints.create).toHaveBeenLastCalledWith("", ctx.hints.dispatchMouseClick, {
      tabbed: true,
      active: true,
    });
  });

  it("gf opens a link in a non-active new tab", () => {
    fire("gf");
    expect(ctx.hints.create).toHaveBeenLastCalledWith("", ctx.hints.dispatchMouseClick, {
      tabbed: true,
      active: false,
    });
  });

  it("cf opens multiple links in new tabs", () => {
    fire("cf");
    expect(ctx.hints.create).toHaveBeenLastCalledWith("", ctx.hints.dispatchMouseClick, {
      multipleHits: true,
    });
  });

  it("<Ctrl-j> creates mouse-out hints", () => {
    fire("<Ctrl-j>");
    expect(ctx.hints.create).toHaveBeenLastCalledWith("", ctx.hints.dispatchMouseClick, {
      mouseEvents: ["mouseout"],
    });
  });

  it("L enters regional hints over the large elements", () => {
    fire("L");
    expect(ctx.hints.create).toHaveBeenLastCalledWith([], expect.any(Function), {
      regionalHints: true,
    });
  });

  it("O creates hints over the clickable pattern with a status line", () => {
    fire("O");
    expect(ctx.hints.create).toHaveBeenLastCalledWith(
      seam.runtimeConf.clickablePat,
      expect.any(Function),
      { statusLine: "Open detected links from text" },
    );
  });

  it(";fs hints the refreshed scrollable elements", () => {
    fire(";fs");
    expect(ctx.normal.refreshScrollableElements).toHaveBeenCalled();
    expect(ctx.hints.create).toHaveBeenLastCalledWith(
      expect.anything(),
      ctx.hints.dispatchMouseClick,
    );
  });

  it("<Ctrl-u>/<Ctrl-d> feed 20-line jumps to visual mode", () => {
    fire("<Ctrl-u>");
    expect(ctx.visual.feedkeys).toHaveBeenLastCalledWith("20k");
    fire("<Ctrl-d>");
    expect(ctx.visual.feedkeys).toHaveBeenLastCalledWith("20j");
  });
});

describe(". repeats the last action", () => {
  const saved = seam.runtimeConf.lastKeys;
  afterEach(() => {
    seam.runtimeConf.lastKeys = saved;
    vi.useRealTimers();
  });

  it("feeds the first recorded key back to normal mode", () => {
    seam.runtimeConf.lastKeys = ["se"];
    fire(".");
    expect(ctx.normal.feedkeys).toHaveBeenLastCalledWith("se");
  });

  it("replays a recorded Hints sub-sequence after its delay", () => {
    vi.useFakeTimers();
    seam.runtimeConf.lastKeys = ["f", "Hints\tBA"];
    fire(".");
    expect(ctx.normal.feedkeys).toHaveBeenLastCalledWith("f");
    vi.advanceTimersByTime(300);
    expect(ctx.hints.feedkeys).toHaveBeenLastCalledWith("BA");
  });
});

describe("yf copies form data as JSON", () => {
  afterEach(() => document.body.replaceChildren());

  it("serializes each form's fields keyed by method::path", () => {
    const form = document.createElement("form");
    form.method = "get";
    form.action = "https://example.com/submit";
    const input = document.createElement("input");
    input.name = "alpha";
    input.value = "1";
    form.appendChild(input);
    document.body.appendChild(form);

    fire("yf");

    const written = ctx.clipboard.write.mock.calls.at(-1)![0];
    expect(written).toContain("get::/submit");
    expect(written).toContain('"alpha": "1"');
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

describe(";ql shows last action via showPopup", () => {
  it("passes the decoded keystroke(s) through htmlEncode and showPopup", () => {
    seam.runtimeConf.lastKeys = ["se"];
    seam.utils.htmlEncode.mockReturnValueOnce("se-encoded");
    fire(";ql");
    expect(seam.utils.showPopup).toHaveBeenLastCalledWith("se-encoded");
    expect(seam.utils.htmlEncode).toHaveBeenCalled();
  });
});

describe("yv copies element text via hint callback", () => {
  const lastHintCallback = () => {
    const calls = ctx.hints.create.mock.calls;
    return calls[calls.length - 1][1] as (el: any) => void;
  };

  it("takes element[2].trim() when element[1] is not 0", () => {
    fire("yv");
    lastHintCallback()([{}, 1, "  trimmed text  "]);
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("trimmed text");
  });

  it("takes element[0].data.trim() when element[1] is 0", () => {
    fire("yv");
    lastHintCallback()([{ data: "  node data  " }, 0, ""]);
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("node data");
  });
});

describe("ymv accumulates multiple element texts", () => {
  const lastHintCallback = () => {
    const calls = ctx.hints.create.mock.calls;
    return calls[calls.length - 1][1] as (el: any) => void;
  };

  it("joins picked texts with newlines as more are selected", () => {
    fire("ymv");
    const cb = lastHintCallback();
    cb([{}, 1, "  first  "]);
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("first");
    cb([{ data: "  second  " }, 0, ""]);
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("first\nsecond");
  });
});

describe("<Ctrl-'> jumps to a VIMark in a new tab", () => {
  it("delegates to normal.jumpVIMark with the given mark", () => {
    registry.get("<Ctrl-'>")!.cb("a");
    expect(ctx.normal.jumpVIMark).toHaveBeenLastCalledWith("a");
  });
});

describe("yma accumulates multiple link URLs", () => {
  const lastHintCallback = () => {
    const calls = ctx.hints.create.mock.calls;
    return calls[calls.length - 1][1] as (el: any) => void;
  };

  it("joins collected hrefs with newlines as links are picked", () => {
    fire("yma");
    const cb = lastHintCallback();
    cb({ href: "https://one.example.com" });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("https://one.example.com");
    cb({ href: "https://two.example.com" });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith(
      "https://one.example.com\nhttps://two.example.com",
    );
  });
});

/** Jsdom does not implement innerText; patch each cell element so the table handlers read real text. */
function buildTable(data: string[][]): HTMLTableElement {
  const table = document.createElement("table");
  for (const rowData of data) {
    const tr = document.createElement("tr");
    for (const cellText of rowData) {
      const td = document.createElement("td");
      Object.defineProperty(td, "innerText", { get: () => cellText, configurable: true });
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  document.body.appendChild(table);
  return table;
}

describe("yc copies a table column", () => {
  afterEach(() => document.body.replaceChildren());

  it("writes newline-joined cell text for the selected column header", () => {
    const table = buildTable([
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
    fire("yc");
    const calls = ctx.hints.create.mock.calls;
    const cb = calls[calls.length - 1][1] as (el: any) => void;
    // Pick the first cell (column 0, cellIndex 0)
    const header = table.rows[0]!.cells[0]!;
    cb(header);
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("Name\nAlice\nBob");
  });
});

describe("ymc copies multiple columns of a table", () => {
  afterEach(() => document.body.replaceChildren());

  it("merges columns with tabs when a second header is picked", () => {
    const table = buildTable([
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
    fire("ymc");
    const calls = ctx.hints.create.mock.calls;
    const cb = calls[calls.length - 1][1] as (el: any) => void;
    cb(table.rows[0]!.cells[0]!);
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("Name\nAlice\nBob");
    cb(table.rows[0]!.cells[1]!);
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("Name\tAge\nAlice\t30\nBob\t25");
  });
});

describe(";pp pastes HTML via clipboard callback", () => {
  it("calls removeAttributes on html/body and setSanitizedContent on head/body", () => {
    let capturedCb: ((r: { data: string }) => void) | null = null;
    ctx.clipboard.read.mockImplementationOnce((cb: (r: { data: string }) => void) => {
      capturedCb = cb;
    });
    fire(";pp");
    capturedCb!({ data: "<p>hello</p>" });
    expect(seam.utils.removeAttributes).toHaveBeenCalledWith(document.documentElement);
    expect(seam.utils.removeAttributes).toHaveBeenCalledWith(document.body);
    expect(seam.utils.setSanitizedContent).toHaveBeenCalledWith(document.body, "<p>hello</p>");
    expect(seam.utils.setSanitizedContent).toHaveBeenCalledWith(
      document.head,
      expect.stringMatching(/updated by Surfingkeys/),
    );
  });
});

describe("yj response callback writes JSON settings to clipboard", () => {
  it("passes response.settings through JSON.stringify with regExpReplacer and writes to clipboard", () => {
    let capturedCb: ((r: { settings: unknown }) => void) | null = null;
    seam.RUNTIME.mockImplementationOnce(
      (_subj: string, _arg: unknown, cb: (r: { settings: unknown }) => void) => {
        capturedCb = cb;
      },
    );
    fire("yj");
    // Leave regExpReplacer returning its second argument (the identity default) so JSON is preserved.
    seam.utils.regExpReplacer.mockImplementation((_k: string, v: unknown) => v);
    capturedCb!({ settings: { foo: "bar" } });
    const written = ctx.clipboard.write.mock.calls.at(-1)![0] as string;
    expect(written).toContain('"foo"');
    expect(written).toContain('"bar"');
    expect(seam.utils.regExpReplacer).toHaveBeenCalled();
  });
});

describe(";pj restores settings from clipboard", () => {
  it("parses clipboard JSON and sends updateSettings", () => {
    let capturedCb: ((r: { data: string }) => void) | null = null;
    ctx.clipboard.read.mockImplementationOnce((cb: (r: { data: string }) => void) => {
      capturedCb = cb;
    });
    fire(";pj");
    capturedCb!({ data: '{"theme":"dark"}' });
    expect(seam.RUNTIME).toHaveBeenLastCalledWith("updateSettings", {
      settings: { theme: "dark" },
    });
  });
});

describe("yY response callback writes tab URLs to clipboard", () => {
  it("joins tab URLs with newlines", () => {
    let capturedCb: ((r: { tabs: { url: string }[] }) => void) | null = null;
    seam.RUNTIME.mockImplementationOnce(
      (_subj: string, _arg: unknown, cb: (r: { tabs: { url: string }[] }) => void) => {
        capturedCb = cb;
      },
    );
    fire("yY");
    capturedCb!({ tabs: [{ url: "https://a.com" }, { url: "https://b.com" }] });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("https://a.com\nhttps://b.com");
  });
});

describe("yQ response callback writes query history to clipboard", () => {
  it("joins OmniQueryHistory entries with newlines", () => {
    let capturedCb: ((r: { settings: { OmniQueryHistory: string[] } }) => void) | null = null;
    seam.RUNTIME.mockImplementationOnce(
      (
        _subj: string,
        _arg: unknown,
        cb: (r: { settings: { OmniQueryHistory: string[] } }) => void,
      ) => {
        capturedCb = cb;
      },
    );
    fire("yQ");
    capturedCb!({ settings: { OmniQueryHistory: ["query1", "query2"] } });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("query1\nquery2");
  });
});

describe("gp response callback focuses the playing tab", () => {
  it("sends focusTab when an audible tab is present", () => {
    let capturedCb: ((r: { tabs?: { windowId: number; id: number }[] }) => void) | null = null;
    seam.RUNTIME.mockImplementationOnce(
      (
        _subj: string,
        _arg: unknown,
        cb: (r: { tabs?: { windowId: number; id: number }[] }) => void,
      ) => {
        capturedCb = cb;
      },
    );
    fire("gp");
    capturedCb!({ tabs: [{ windowId: 1, id: 42 }] });
    expect(seam.RUNTIME).toHaveBeenLastCalledWith("focusTab", { windowId: 1, tabId: 42 });
  });

  it("does not call focusTab when no audible tab is present", () => {
    let capturedCb: ((r: { tabs?: unknown[] }) => void) | null = null;
    seam.RUNTIME.mockImplementationOnce(
      (_subj: string, _arg: unknown, cb: (r: { tabs?: unknown[] }) => void) => {
        capturedCb = cb;
      },
    );
    fire("gp");
    const callsBefore = seam.RUNTIME.mock.calls.length;
    capturedCb!({ tabs: [] });
    expect(seam.RUNTIME.mock.calls.length).toBe(callsBefore);
  });
});

describe("yd response callback writes download URLs to clipboard", () => {
  it("joins in-progress download URLs with commas", () => {
    let capturedCb: ((r: { downloads: { url: string }[] }) => void) | null = null;
    seam.RUNTIME.mockImplementationOnce(
      (_subj: string, _arg: unknown, cb: (r: { downloads: { url: string }[] }) => void) => {
        capturedCb = cb;
      },
    );
    fire("yd");
    capturedCb!({ downloads: [{ url: "https://file1.zip" }, { url: "https://file2.zip" }] });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("https://file1.zip,https://file2.zip");
  });
});

describe(";yh response callback writes history URLs to clipboard", () => {
  it("joins history URLs with newlines", () => {
    let capturedCb: ((r: { history: { url: string }[] }) => void) | null = null;
    seam.RUNTIME.mockImplementationOnce(
      (_subj: string, _arg: unknown, cb: (r: { history: { url: string }[] }) => void) => {
        capturedCb = cb;
      },
    );
    fire(";yh");
    capturedCb!({ history: [{ url: "https://visited.com" }, { url: "https://other.com" }] });
    expect(ctx.clipboard.write).toHaveBeenLastCalledWith("https://visited.com\nhttps://other.com");
  });
});

describe(";ph puts histories from clipboard", () => {
  it("splits clipboard text by newline and sends addHistories", () => {
    let capturedCb: ((r: { data: string }) => void) | null = null;
    ctx.clipboard.read.mockImplementationOnce((cb: (r: { data: string }) => void) => {
      capturedCb = cb;
    });
    fire(";ph");
    capturedCb!({ data: "https://a.com\nhttps://b.com" });
    expect(seam.RUNTIME).toHaveBeenLastCalledWith("addHistories", {
      history: ["https://a.com", "https://b.com"],
    });
  });
});

describe(";di downloads an image via hint callback", () => {
  it("sends a download RUNTIME message with the element src", () => {
    fire(";di");
    const calls = ctx.hints.create.mock.calls;
    const cb = calls[calls.length - 1][1] as (el: any) => void;
    cb({ src: "https://example.com/image.png" });
    expect(seam.RUNTIME).toHaveBeenLastCalledWith("download", {
      url: "https://example.com/image.png",
    });
  });
});

describe("yp copies POST form data", () => {
  afterEach(() => document.body.replaceChildren());

  it("serializes form fields as URL-encoded strings keyed by method::action", () => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "https://example.com/submit";
    const input = document.createElement("input");
    input.name = "field";
    input.value = "value";
    form.appendChild(input);
    document.body.appendChild(form);

    fire("yp");

    const written = ctx.clipboard.write.mock.calls.at(-1)![0];
    const parsed = JSON.parse(written) as Array<Record<string, string>>;
    const entry = parsed[0]!;
    const key = Object.keys(entry)[0]!;
    expect(key).toContain("post::");
    expect(entry[key]).toContain("field=value");
  });
});

describe("ab bookmarks the current page", () => {
  it("opens AddBookmark omnibar with current URL and title", () => {
    document.title = "My Page";
    fire("ab");
    expect(ctx.front.openOmnibar).toHaveBeenLastCalledWith({
      type: "AddBookmark",
      extra: { url: window.location.href, title: "My Page" },
    });
  });
});

describe(";w focuses the top window", () => {
  it("calls top.focus()", () => {
    // In jsdom top === window, so top.focus() is observable as window.focus().
    const spy = vi.spyOn(window, "focus").mockImplementation(() => {});
    fire(";w");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("cc opens selected text or clipboard URL in a new tab", () => {
  it("opens the selected text as a URL when selection is non-empty", () => {
    const sel = { toString: () => "https://selected.example.com" };
    vi.spyOn(window, "getSelection").mockReturnValue(sel as unknown as Selection);
    fire("cc");
    expect(seam.utils.tabOpenLink).toHaveBeenLastCalledWith("https://selected.example.com");
    vi.restoreAllMocks();
  });

  it("reads from clipboard and opens the URL when selection is empty", () => {
    const sel = { toString: () => "" };
    vi.spyOn(window, "getSelection").mockReturnValue(sel as unknown as Selection);
    let capturedCb: ((r: { data: string }) => void) | null = null;
    ctx.clipboard.read.mockImplementationOnce((cb: (r: { data: string }) => void) => {
      capturedCb = cb;
    });
    fire("cc");
    capturedCb!({ data: "https://clipboard.example.com" });
    expect(seam.utils.tabOpenLink).toHaveBeenLastCalledWith("https://clipboard.example.com");
    vi.restoreAllMocks();
  });
});

describe("cq queries word under cursor via hint callback", () => {
  it("calls front.performInlineQuery with the trimmed word", () => {
    fire("cq");
    const calls = ctx.hints.create.mock.calls;
    const cb = calls[calls.length - 1][1] as (el: any) => void;
    // element[2] is the text fragment; element[0] is the text node; element[1] is offset
    cb([{}, 0, "  hello  "]);
    expect(ctx.front.performInlineQuery).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({ top: 0, left: 0 }),
      expect.any(Function),
    );
  });

  it("the showBubble callback dispatches a front event", () => {
    fire("cq");
    const calls = ctx.hints.create.mock.calls;
    const cb = calls[calls.length - 1][1] as (el: any) => void;
    cb([{}, 0, "hello"]);
    const queryCallback = ctx.front.performInlineQuery.mock.calls.at(-1)![2] as (
      pos: unknown,
      result: unknown,
    ) => void;
    queryCallback({ x: 0 }, "translation result");
    expect(seam.dispatchSKEvent).toHaveBeenLastCalledWith("front", [
      "showBubble",
      { x: 0 },
      "translation result",
      false,
    ]);
  });
});

describe("search alias suggestion parsers", () => {
  const getParser = (alias: string) => {
    const call = api.addSearchAlias.mock.calls.find((c: unknown[]) => c[0] === alias);
    return call![5] as (response: { text: string }) => unknown;
  };

  it("duckduckgo parser returns phrase from each result", () => {
    const parse = getParser("d");
    expect(parse({ text: JSON.stringify([{ phrase: "alpha" }, { phrase: "beta" }]) })).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("baidu parser extracts the suggestion array from the response text", () => {
    const parse = getParser("b");
    expect(parse({ text: ',s:["foo","bar"]}' })).toEqual(["foo", "bar"]);
  });

  it("baidu parser returns empty array when no match", () => {
    const parse = getParser("b");
    expect(parse({ text: "no match here" })).toEqual([]);
  });

  it("wikipedia parser returns the completions array at index 1", () => {
    const parse = getParser("e");
    expect(parse({ text: JSON.stringify([null, ["TypeScript", "Telnet"]]) })).toEqual([
      "TypeScript",
      "Telnet",
    ]);
  });

  it("bing parser returns completions from index 1", () => {
    const parse = getParser("w");
    expect(parse({ text: JSON.stringify([null, ["bing1", "bing2"]]) })).toEqual(["bing1", "bing2"]);
  });

  it("github parser maps items to title/url objects", () => {
    const parse = getParser("h");
    const items = [
      { description: "A lib", html_url: "https://github.com/a/lib" },
      { description: "B tool", html_url: "https://github.com/b/tool" },
    ];
    expect(parse({ text: JSON.stringify({ items }) })).toEqual([
      { title: "A lib", url: "https://github.com/a/lib" },
      { title: "B tool", url: "https://github.com/b/tool" },
    ]);
  });

  it("github parser returns empty array when items is null", () => {
    const parse = getParser("h");
    expect(parse({ text: JSON.stringify({ items: null }) })).toEqual([]);
  });

  it("youtube parser extracts suggestion strings from the JSONP payload", () => {
    const parse = getParser("y");
    const inner = [null, [["suggestion1"], ["suggestion2"]]];
    const text = "callback(" + JSON.stringify(inner) + ")";
    expect(parse({ text })).toEqual(["suggestion1", "suggestion2"]);
  });
});

describe("w switches frames", () => {
  it("dispatches ensureFrontEnd and calls hints.create for iframes", () => {
    fire("w");
    expect(seam.dispatchSKEvent).toHaveBeenCalledWith("ensureFrontEnd");
    expect(ctx.hints.create).toHaveBeenLastCalledWith("iframe", expect.any(Function));
  });

  it("rotates frame when hints.create resolves with 0 total hints", async () => {
    ctx.hints.create.mockResolvedValueOnce(0);
    fire("w");
    await Promise.resolve();
    expect(ctx.normal.rotateFrame).toHaveBeenCalled();
  });

  it("does not rotate frame when at least one iframe hint was shown", async () => {
    ctx.hints.create.mockResolvedValueOnce(1);
    fire("w");
    await Promise.resolve();
    expect(ctx.normal.rotateFrame).not.toHaveBeenCalled();
  });
});

describe("<Ctrl-h> mouse-over hint callback falls back to dispatchMouseClick", () => {
  it("calls hints.dispatchMouseClick when chrome.surfingkeys is absent", () => {
    fire("<Ctrl-h>");
    const calls = ctx.hints.create.mock.calls;
    const cb = calls[calls.length - 1][1] as (el: any) => void;
    const fakeEl = { getClientRects: () => [{ x: 0, y: 0, width: 10, height: 10 }] };
    cb(fakeEl);
    expect(ctx.hints.dispatchMouseClick).toHaveBeenLastCalledWith(fakeEl);
  });
});

describe("yg captures the visible tab", () => {
  afterEach(() => vi.useRealTimers());

  it("toggles status off then sends captureVisibleTab after 500ms", () => {
    vi.useFakeTimers();
    fire("yg");
    expect(ctx.front.toggleStatus).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(500);
    expect(seam.RUNTIME).toHaveBeenLastCalledWith("captureVisibleTab", null, expect.any(Function));
  });

  it("the captureVisibleTab callback toggles status back on and shows the image", () => {
    vi.useFakeTimers();
    let capturedCb: ((r: { dataUrl: string }) => void) | null = null;
    seam.RUNTIME.mockImplementationOnce(
      (_s: string, _a: unknown, cb: (r: { dataUrl: string }) => void) => {
        capturedCb = cb;
      },
    );
    fire("yg");
    vi.advanceTimersByTime(500);
    capturedCb!({ dataUrl: "data:image/png;base64,abc" });
    expect(ctx.front.toggleStatus).toHaveBeenLastCalledWith(true);
    expect(seam.utils.showPopup).toHaveBeenLastCalledWith(
      expect.stringContaining("data:image/png;base64,abc"),
    );
  });
});
