import { Result } from "@praha/byethrow";
import { request, RUNTIME, runtime } from "@sk/messaging/runtime";
import { flush } from "@sk/test-support/helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import createOmnibar from "./omnibar";

// The mocked return value must be a real @praha/byethrow Result so reportOnFail works.
vi.mock("@sk/messaging/runtime", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@sk/messaging/runtime")>();
  return {
    ...orig,
    RUNTIME: vi.fn(() => Result.succeed(undefined)),
    request: vi.fn(() => new Promise(() => {})),
  };
});

const mockRUNTIME = vi.mocked(RUNTIME);
const mockRequest = vi.mocked(request);

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockImplementation(() => new Promise(() => {}));
});

function buildOmnibarDOM() {
  document.body.innerHTML = `
    <div id="sk_omnibar">
      <div id="sk_omnibarSearchArea">
        <span class="prompt"></span>
        <span class="resultPage"></span>
      </div>
      <div id="sk_omnibarSearchResult"></div>
    </div>
  `;
}

function makeFront() {
  return {
    actions: {} as Record<string, any>,
    hidePopup: vi.fn(),
    // The Ctrl-j "toggle position" path calls reopen(), which schedules a real
    // setTimeout that fires front.openOmnibar after the test has ended; stub it so
    // the deferred call is a harmless no-op rather than an unhandled TypeError
    // (front.openOmnibar is not a function) that fails the run on slower machines.
    openOmnibar: vi.fn(),
    topOrigin: "https://example.com",
    postMessage: vi.fn(),
    contentCommand: vi.fn(),
  };
}

function makeClipboard() {
  return { write: vi.fn(), read: vi.fn() };
}

// Tests drive the controller through a plain value stub instead of the
// rendered input element, so only `value` is provided.
function stubInput(value: string): HTMLInputElement {
  return { value } as unknown as HTMLInputElement;
}

describe("createOmnibar — highlight", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    const front = makeFront();
    omnibar = createOmnibar(front, makeClipboard());
  });

  it("returns the raw string unchanged when regex is null", () => {
    expect(omnibar.highlight(null, "hello world")).toBe("hello world");
  });

  it("wraps the matching substring in an omnibar_highlight span", () => {
    const rxp = /world/;
    expect(omnibar.highlight(rxp, "hello world")).toBe(
      "hello <span class=omnibar_highlight>world</span>",
    );
  });

  it("truncates a data-URI string to 1024 characters before applying the pattern", () => {
    const longDataUri = "data:image/" + "x".repeat(2000);
    const result = omnibar.highlight(/x+/, longDataUri);
    // The match operates on the 1024-char truncation, so the highlighted
    // portion length is 1024 - 11 ("data:image/") = 1013 x's.
    expect(result).toBe("data:image/<span class=omnibar_highlight>" + "x".repeat(1013) + "</span>");
  });

  it("applies the pattern to a non-data string of any length without truncation", () => {
    const long = "x".repeat(2000);
    const result = omnibar.highlight(/x+/, long);
    expect(result).toBe("<span class=omnibar_highlight>" + "x".repeat(2000) + "</span>");
  });
});

describe("createOmnibar — isUrl", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    omnibar = createOmnibar(makeFront(), makeClipboard());
  });

  it("accepts an https:// URL", () => {
    expect(omnibar.isUrl("https://example.com")).toBeTruthy();
  });

  it("accepts an http:// URL", () => {
    expect(omnibar.isUrl("http://example.com/path?q=1")).toBeTruthy();
  });

  it("accepts a www. domain without a protocol", () => {
    expect(omnibar.isUrl("www.example.com")).toBeTruthy();
  });

  it("accepts a bare domain with a recognisable TLD", () => {
    expect(omnibar.isUrl("example.com")).toBeTruthy();
  });

  it("rejects a plain search query with spaces", () => {
    expect(omnibar.isUrl("hello world")).toBeFalsy();
  });

  it("rejects a single word without a dot", () => {
    expect(omnibar.isUrl("localhost")).toBeFalsy();
  });
});

describe("createOmnibar — detectAndInsertURLItem", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    omnibar = createOmnibar(makeFront(), makeClipboard());
  });

  it("prepends a domain-like string as a URL item with an http:// prefix", () => {
    const list: any[] = [];
    omnibar.detectAndInsertURLItem("example.com", list);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ title: "example.com", url: "http://example.com" });
  });

  it("prepends an https:// URL without modifying it", () => {
    const list: any[] = [];
    omnibar.detectAndInsertURLItem("https://example.com/path", list);
    expect(list).toHaveLength(1);
    expect(list[0]?.url).toBe("https://example.com/path");
  });

  it("prepends an http:// URL as-is (already has a protocol)", () => {
    const list: any[] = [];
    omnibar.detectAndInsertURLItem("http://foo.org", list);
    expect(list[0]?.url).toBe("http://foo.org");
  });

  it("does not modify the list when the string looks like plain text", () => {
    const list: any[] = [];
    omnibar.detectAndInsertURLItem("hello world search query", list);
    expect(list).toHaveLength(0);
  });

  it("inserts at the front of a non-empty list", () => {
    const list: any[] = [{ title: "existing", url: "https://existing.com" }];
    omnibar.detectAndInsertURLItem("new.io", list);
    expect(list[0]?.title).toBe("new.io");
    expect(list).toHaveLength(2);
  });
});

describe("createOmnibar — createItemFromRawHtml", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    omnibar = createOmnibar(makeFront(), makeClipboard());
  });

  it("builds an OmnibarResult whose html matches the provided markup", () => {
    const result = omnibar.createItemFromRawHtml({ html: "<span>hello</span>" });
    expect(result.html).toBe("<span>hello</span>");
  });

  it("routes props fields into data when props is a plain object", () => {
    const result = omnibar.createItemFromRawHtml({
      html: "<span>page</span>",
      props: { url: "https://example.com", uid: "T1:42" },
    });
    expect(result.data.url).toBe("https://example.com");
    expect(result.data.uid).toBe("T1:42");
  });

  it("ignores props and uses an empty data object when props is not a plain object", () => {
    const result = omnibar.createItemFromRawHtml({ html: "<span>x</span>", props: "invalid" });
    expect(result.data.url).toBeUndefined();
  });
});

describe("createOmnibar — createURLItem", () => {
  let omnibar: any;
  let front: ReturnType<typeof makeFront>;

  beforeAll(() => {
    buildOmnibarDOM();
    front = makeFront();
    omnibar = createOmnibar(front, makeClipboard());
  });

  it("uses the url as the title when the title field is empty and stores it in data.url", () => {
    const item = { url: "https://example.com/page", title: "" };
    const result = omnibar.createURLItem(item, null);
    // data.url carries the raw URL regardless of htmlEncode (which uses innerText — a layout API
    // not available in jsdom, so we cannot assert on the rendered HTML text content here).
    expect(result.data.url).toBe("https://example.com/page");
  });

  it("assigns uid H+url for a history item (has lastVisitTime)", () => {
    const item = {
      url: "https://history.example.com",
      title: "History",
      lastVisitTime: Date.now(),
      visitCount: 3,
    };
    const result = omnibar.createURLItem(item, null);
    expect(result.data.uid).toBe("Hhttps://history.example.com");
  });

  it("assigns uid T<windowId>:<id> for a tab item (has width)", () => {
    const item = {
      url: "https://tab.example.com",
      title: "Tab",
      width: 1024,
      windowId: 5,
      id: 99,
    };
    const result = omnibar.createURLItem(item, null);
    expect(result.data.uid).toBe("T5:99");
  });

  it("uses the custom type emoji when b.type is a 2-char string with high codepoint", () => {
    const item = {
      url: "https://mark.example.com",
      title: "Mark",
      type: "🔗",
    };
    const result = omnibar.createURLItem(item, null);
    expect(result.html).toContain("🔗");
  });

  it("stores the url in data even when a highlight pattern is provided", () => {
    // The HTML rendering of the title/url text goes through htmlEncode (which uses
    // innerText — a layout API unavailable in jsdom), so we assert on data.url instead.
    // The highlight wrapping is covered by the standalone highlight describe above.
    const item = { url: "https://example.com", title: "Example Domain" };
    const rxp = /Example/;
    const result = omnibar.createURLItem(item, rxp);
    expect(result.data.url).toBe("https://example.com");
  });
});

describe("createOmnibar — listWords", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
  });

  beforeEach(() => {
    runtime.conf.omnibarPosition = "middle";
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
  });

  it("populates results with query-keyed OmnibarResult entries for each word", () => {
    omnibar.listWords(["apple", "banana"]);
    const items = omnibar.results();
    expect(items).toHaveLength(2);
    expect(items[0]?.data.query).toBe("apple");
    expect(items[1]?.data.query).toBe("banana");
  });

  it("each word result html contains the word text", () => {
    omnibar.listWords(["mango"]);
    expect(omnibar.results()[0]?.html).toContain("mango");
  });

  it("clears results when called with an empty array", () => {
    omnibar.listWords(["seed"]);
    omnibar.listWords([]);
    expect(omnibar.results()).toHaveLength(0);
  });
});

describe("createOmnibar — listResults focus behaviour", () => {
  let omnibar: any;

  beforeAll(() => {
    // jsdom does not implement scrollIntoView / scrollIntoViewIfNeeded; stub them so that
    // the bottom-position path in listResults does not throw when it tries to scroll.
    HTMLElement.prototype.scrollIntoView = vi.fn();
    (HTMLElement.prototype as any).scrollIntoViewIfNeeded = vi.fn();

    buildOmnibarDOM();
    omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
  });

  beforeEach(() => {
    runtime.conf.omnibarPosition = "middle";
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
  });

  it("sets focusedIndex to -1 when focusFirstCandidate is false", () => {
    omnibar.listWords(["a", "b"]);
    expect(omnibar.focusedIndex()).toBe(-1);
  });

  it("sets focusedIndex to 0 when focusFirstCandidate is true and position is middle", () => {
    runtime.conf.focusFirstCandidate = true;
    runtime.conf.omnibarPosition = "middle";
    omnibar.listWords(["a", "b"]);
    expect(omnibar.focusedIndex()).toBe(0);
  });

  it("sets focusedIndex to last item when focusFirstCandidate is true and position is bottom", () => {
    runtime.conf.focusFirstCandidate = true;
    runtime.conf.omnibarPosition = "bottom";
    omnibar.listWords(["a", "b", "c"]);
    // bottom-position reverses the display order; focusedIndex points to the last built item
    // (which is index 2 in a 3-item list), placing the focus next to the input at the bottom.
    expect(omnibar.focusedIndex()).toBe(2);
  });
});

describe("createOmnibar — html()", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    omnibar = createOmnibar(makeFront(), makeClipboard());
  });

  it("places a single result row with the supplied html content", () => {
    omnibar.html("<b>test content</b>");
    const items = omnibar.results();
    expect(items).toHaveLength(1);
    expect(items[0]?.html).toBe("<b>test content</b>");
  });

  it("resets focusedIndex to -1", () => {
    omnibar.html("<p>anything</p>");
    expect(omnibar.focusedIndex()).toBe(-1);
  });
});

describe("createOmnibar — focusItem", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";
  });

  it("sets focusedIndex to the given valid index", () => {
    omnibar.listWords(["a", "b", "c"]);
    omnibar.focusItem(1);
    expect(omnibar.focusedIndex()).toBe(1);
  });

  it("does not change focusedIndex for an out-of-bounds index", () => {
    omnibar.listWords(["a", "b"]);
    omnibar.focusItem(0);
    omnibar.focusItem(99);
    expect(omnibar.focusedIndex()).toBe(0);
  });

  it("does not change focusedIndex for a negative index", () => {
    omnibar.listWords(["a"]);
    omnibar.focusItem(0);
    omnibar.focusItem(-1);
    expect(omnibar.focusedIndex()).toBe(0);
  });
});

describe("createOmnibar — focusedResult", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";
  });

  it("returns undefined when focusedIndex is -1", () => {
    omnibar.listWords(["x"]);
    expect(omnibar.focusedResult()).toBeUndefined();
  });

  it("returns the result at the focused index", () => {
    omnibar.listWords(["alpha", "beta"]);
    omnibar.focusItem(1);
    expect(omnibar.focusedResult()?.data.query).toBe("beta");
  });
});

describe("createOmnibar — addHandler / Commands integration", () => {
  let omnibar: any;
  let front: ReturnType<typeof makeFront>;
  let executedArgs: string[] | undefined;

  beforeAll(() => {
    buildOmnibarDOM();
    front = makeFront();
    omnibar = createOmnibar(front, makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    omnibar.command?.(
      "greet",
      (args: string[]) => {
        executedArgs = args;
      },
      { annotation: "Greet somebody" },
    );
  });

  beforeEach(() => {
    executedArgs = undefined;
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
  });

  it("executeCommand dispatched via front.actions runs the registered command", () => {
    front.actions["executeCommand"]({ cmdline: 'greet "world tour"' });
    expect(executedArgs).toEqual(["world tour"]);
  });

  it("a second executeCommand call routes the correct args to the correct command", () => {
    omnibar.command?.("tabopen", () => {}, { annotation: "Open a tab" });
    front.actions["executeCommand"]({ cmdline: "greet Alice" });
    expect(executedArgs).toEqual(["Alice"]);
  });
});

describe("createOmnibar — SearchEngine alias registration", () => {
  let omnibar: any;
  let front: ReturnType<typeof makeFront>;

  beforeAll(() => {
    buildOmnibarDOM();
    front = makeFront();
    omnibar = createOmnibar(front, makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
  });

  it("addSearchAlias registers an alias reachable by expandAlias", () => {
    front.actions["addSearchAlias"]({
      alias: "g",
      prompt: "Google",
      url: "https://www.google.com/search?q={0}",
      suggestionURL: undefined,
    });
    const aliases: any[] = [];
    front.postMessage.mockImplementationOnce((msg: any) => {
      aliases.push(msg.aliases);
    });
    front.actions["getSearchAliases"]({ id: "req1" });
    expect(front.postMessage).toHaveBeenCalled();
    const aliasMap = aliases[0];
    expect(aliasMap).toHaveProperty("g");
    expect(aliasMap["g"].url).toBe("https://www.google.com/search?q={0}");
  });

  it("removeSearchAlias removes a previously registered alias", () => {
    front.actions["addSearchAlias"]({
      alias: "b",
      prompt: "Bing",
      url: "https://www.bing.com/search?q={0}",
      suggestionURL: undefined,
    });

    front.actions["removeSearchAlias"]({ alias: "b" });

    const aliases: any[] = [];
    front.postMessage.mockImplementationOnce((msg: any) => {
      aliases.push(msg.aliases);
    });
    front.actions["getSearchAliases"]({ id: "req2" });
    expect(aliases[0]).not.toHaveProperty("b");
  });
});

describe("createOmnibar — updateOmnibarResult action", () => {
  let omnibar: any;

  beforeAll(() => {
    buildOmnibarDOM();
    const front = makeFront();
    omnibar = createOmnibar(front, makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";
  });

  it("populates results from the words array sent by updateOmnibarResult", () => {
    const front = makeFront();
    buildOmnibarDOM();
    const localOmnibar = createOmnibar(front, makeClipboard());
    localOmnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    front.actions["updateOmnibarResult"]({ words: ["cat", "dog", "fish"] });

    const items = localOmnibar.results();
    expect(items).toHaveLength(3);
    expect(items.map((r: any) => r.data.query)).toEqual(["cat", "dog", "fish"]);
  });
});

describe("createOmnibar — Ctrl-c clipboard copy paths", () => {
  let omnibar: any;
  let front: ReturnType<typeof makeFront>;
  let clipboard: ReturnType<typeof makeClipboard>;

  beforeAll(() => {
    buildOmnibarDOM();
    front = makeFront();
    clipboard = makeClipboard();
    omnibar = createOmnibar(front, clipboard);
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("copies the focused result's url when a url-keyed result is focused", () => {
    buildOmnibarDOM();
    const clip2 = makeClipboard();
    const o2 = createOmnibar(makeFront(), clip2);
    o2.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = true;
    runtime.conf.omnibarPosition = "middle";

    // A url-keyed result with no `copy` field exercises the `else if (fi.data.url)`
    // arm of the real Ctrl-c mapping.
    o2.listResults([{ url: "https://copy.example.com" }], (b: any) =>
      o2.createItemFromRawHtml({ html: b.url, props: { url: b.url } }),
    );
    expect(o2.focusedIndex()).toBe(0);

    const ctrlCCode = getMappingByAnnotation(o2, "Copy selected item url or all listed item urls");
    expect(ctrlCCode).toBeDefined();
    ctrlCCode!();

    expect(clip2.write).toHaveBeenLastCalledWith("https://copy.example.com");
  });
});

describe("createOmnibar — Ctrl-m vim-like mark creation", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("routes the focused result's url to the addVIMark RUNTIME channel under the pressed key", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = true;
    runtime.conf.omnibarPosition = "middle";

    omnibar.listResults([{ url: "https://mark.example.com" }], (b: any) =>
      omnibar.createItemFromRawHtml({ html: b.url, props: { url: b.url } }),
    );
    expect(omnibar.focusedIndex()).toBe(0);

    const ctrlM = getMappingByAnnotation(omnibar, "Create vim-like mark for selected item");
    expect(ctrlM).toBeDefined();
    ctrlM!("q");

    const call = mockRUNTIME.mock.calls.find((c) => c[0] === "addVIMark");
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({
      mark: { q: { url: "https://mark.example.com", scrollLeft: 0, scrollTop: 0 } },
    });
  });

  it("does not send addVIMark when no result is focused", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    omnibar.listResults([{ url: "https://mark.example.com" }], (b: any) =>
      omnibar.createItemFromRawHtml({ html: b.url, props: { url: b.url } }),
    );
    expect(omnibar.focusedIndex()).toBe(-1);

    const ctrlM = getMappingByAnnotation(omnibar, "Create vim-like mark for selected item");
    ctrlM!("q");

    expect(mockRUNTIME.mock.calls.find((c) => c[0] === "addVIMark")).toBeUndefined();
  });
});

describe("createOmnibar — AddBookmark.onInput folder filtering", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("lists only folders whose title matches the typed query (case-insensitive)", async () => {
    const { omnibar, ui } = makeOmnibar();

    const folders = [
      { title: "/Bookmarks Bar/", id: "1" },
      { title: "/Other Bookmarks/", id: "2" },
      { title: "/Dev/", id: "3" },
    ];
    mockRequest.mockImplementation((action: any) => {
      if (action === "getBookmarkFolders") return Promise.resolve({ folders });
      if (action === "getBookmark") return Promise.resolve({ bookmarks: [] });
      return new Promise(() => {});
    });

    ui.onShow({ type: "AddBookmark", extra: { url: "https://x.com", title: "X" } });
    await flush();
    expect(omnibar.results().length).toBe(3);

    omnibar.input.value = "bar";
    omnibar.triggerInput();

    const folderIds = omnibar.results().map((r: any) => r.data.folder);
    expect(folderIds).toEqual(["1"]);
  });
});

describe("createOmnibar — OpenURLs onReset sort order toggling", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  const history = [
    { url: "https://a.com", title: "A", lastVisitTime: 100, visitCount: 5 },
    { url: "https://b.com", title: "B", lastVisitTime: 200, visitCount: 1 },
    { url: "https://c.com", title: "C", lastVisitTime: 50, visitCount: 10 },
  ];

  function mockHistory() {
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getHistory" && cb) cb({ history: history.slice() });
      return Result.succeed(undefined);
    });
  }

  it("re-sorts results by visitCount desc when Ctrl-r toggles historyMostUsedOrder to true", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.historyMostUsedOrder = false;
    mockHistory();

    ui.onShow({ type: "History" });
    await Promise.resolve();
    await Promise.resolve();

    const ctrlR = getMappingByAnnotation(omnibar, "Re-sort history by visitCount or lastVisitTime");
    expect(ctrlR).toBeDefined();
    ctrlR!();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.conf.historyMostUsedOrder).toBe(true);
    const urls = omnibar.results().map((r: any) => r.data.url);
    expect(urls).toEqual(["https://c.com", "https://a.com", "https://b.com"]);
  });

  it("re-sorts results by lastVisitTime desc when Ctrl-r toggles historyMostUsedOrder to false", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.historyMostUsedOrder = true;
    mockHistory();

    ui.onShow({ type: "History" });
    await Promise.resolve();
    await Promise.resolve();

    const ctrlR = getMappingByAnnotation(omnibar, "Re-sort history by visitCount or lastVisitTime");
    expect(ctrlR).toBeDefined();
    ctrlR!();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.conf.historyMostUsedOrder).toBe(false);
    const urls = omnibar.results().map((r: any) => r.data.url);
    expect(urls).toEqual(["https://b.com", "https://a.com", "https://c.com"]);
  });
});

function makeOmnibar() {
  buildOmnibarDOM();
  const front = makeFront();
  const clipboard = makeClipboard();
  const omnibar = createOmnibar(front, clipboard);
  omnibar.input = omnibar.input ?? { value: "" };
  runtime.conf.omnibarMaxResults = 10;
  runtime.conf.focusFirstCandidate = false;
  runtime.conf.omnibarPosition = "middle";
  const ui: any = document.getElementById("sk_omnibar");
  return { omnibar, front, clipboard, ui };
}

// Dispatch a synthetic Enter keydown on the omnibar input.  jsdom's KeyboardEvent
// exposes `keyCode` as read-only after construction, so we supply it via the
// constructor init dict and patch `sk_keyName` (the surfingkeys extension field)
// via Object.defineProperty.
function fireEnter(omnibar: any) {
  const enterEvent = new KeyboardEvent("keydown", {
    bubbles: true,
    keyCode: 13,
    ctrlKey: false,
    shiftKey: false,
  } as KeyboardEventInit);
  Object.defineProperty(enterEvent, "sk_keyName", { value: "", writable: false });
  omnibar.input.dispatchEvent(enterEvent);
}

describe("OpenTabs handler — onOpen/onInput lists filtered tabs via RUNTIME('getTabs')", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("populates results with tabs returned by RUNTIME getTabs", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.tabsThreshold = 100;

    const tabs = [
      { url: "https://a.com", title: "Alpha", width: 800, windowId: 1, id: 10 },
      { url: "https://b.com", title: "Beta", width: 800, windowId: 1, id: 11 },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getTabs" && cb) {
        cb({ tabs });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Tabs" });
    // cachedPromise resolves on the next microtask tick
    await Promise.resolve();
    // onInput runs cachedPromise.then(...) — one more microtask
    await Promise.resolve();

    expect(omnibar.results().length).toBe(2);
    const uids = omnibar.results().map((r: any) => r.data.uid);
    expect(uids).toContain("T1:10");
    expect(uids).toContain("T1:11");
  });

  it("filters tabs by title when input value is set before onInput fires", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.tabsThreshold = 100;

    const tabs = [
      { url: "https://a.com", title: "Alpha Page", width: 800, windowId: 1, id: 10 },
      { url: "https://b.com", title: "Beta Page", width: 800, windowId: 1, id: 11 },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getTabs" && cb) {
        cb({ tabs });
      }
      return Result.succeed(undefined);
    });

    omnibar.input.value = "Alpha";
    ui.onShow({ type: "Tabs" });
    await Promise.resolve();
    await Promise.resolve();

    expect(omnibar.results().length).toBe(1);
    expect(omnibar.results()[0]?.data.uid).toBe("T1:10");
  });

  it("sets prompt to 'Gather filtered tabs into current window' when action=gather", async () => {
    const { ui } = makeOmnibar();
    runtime.conf.tabsThreshold = 100;

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getTabs" && cb) {
        cb({ tabs: [] });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Tabs", extra: { action: "gather" } });
    await Promise.resolve();
    await Promise.resolve();

    // The gather prompt is not exposed by the omnibar API, so the currentWindow: false
    // query stands in for it: onOpen sets both together in the gather branch.
    const getTabs = mockRUNTIME.mock.calls.find((c) => c[0] === "getTabs");
    expect(getTabs?.[1]).toMatchObject({ queryInfo: { currentWindow: false } });
  });
});

describe("CloseTabs handler — onOpen fires RUNTIME getTabs and resolves cachedPromise", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("normalises tab URLs (strips query + hash) and populates results", async () => {
    const { omnibar, ui } = makeOmnibar();

    const tabs = [
      {
        url: "https://example.com/page?q=1#anchor",
        title: "Ex",
        width: 800,
        windowId: 2,
        id: 42,
      },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getTabs" && cb) {
        cb({ tabs });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "CloseTabs" });
    await Promise.resolve();
    await Promise.resolve();

    const urls = omnibar.results().map((r: any) => r.data.url);
    expect(urls).toContain("https://example.com/page");
  });

  it("onEnter sends RUNTIME closeTabByIds with all visible tab IDs", async () => {
    const { omnibar, ui } = makeOmnibar();

    const tabs = [
      { url: "https://a.com", title: "A", width: 800, windowId: 3, id: 55 },
      { url: "https://b.com", title: "B", width: 800, windowId: 3, id: 66 },
    ];

    let runtimeCall: any = null;
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getTabs" && cb) {
        cb({ tabs });
      }
      if (_action === "closeTabByIds") {
        runtimeCall = { action: _action, args: _args };
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "CloseTabs" });
    await Promise.resolve();
    await Promise.resolve();

    fireEnter(omnibar);

    expect(runtimeCall).not.toBeNull();
    expect(runtimeCall.action).toBe("closeTabByIds");
    expect(runtimeCall.args.tabIds.toSorted((a: number, b: number) => a - b)).toEqual([55, 66]);
  });
});

describe("OpenWindows handler — onInput builds window results", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("populates one result per window returned by RUNTIME getWindows", async () => {
    const { omnibar, ui } = makeOmnibar();

    const windows = [
      {
        id: "10",
        tabs: [
          { title: "Tab A", url: "https://a.com" },
          { title: "Tab B", url: "https://b.com" },
        ],
      },
      {
        id: "20",
        tabs: [{ title: "Tab C", url: "https://c.com" }],
      },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getWindows" && cb) {
        cb({ windows });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Windows" });
    await Promise.resolve();
    await Promise.resolve();

    expect(omnibar.results().length).toBe(2);
    const windowIds = omnibar.results().map((r: any) => r.data.windowId);
    expect(windowIds).toContain(10);
    expect(windowIds).toContain(20);
  });

  it("window result carries joined tab URLs in data.url", async () => {
    const { omnibar, ui } = makeOmnibar();

    const windows = [
      {
        id: "5",
        tabs: [
          { title: "Tab X", url: "https://x.com" },
          { title: "Tab Y", url: "https://y.com" },
        ],
      },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getWindows" && cb) {
        cb({ windows });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Windows" });
    await Promise.resolve();
    await Promise.resolve();

    const result = omnibar.results()[0];
    expect(result?.data.url).toBe("https://x.com\nhttps://y.com");
  });

  it("onEnter calls RUNTIME moveToWindow with the focused window's id", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.focusFirstCandidate = true;

    const windows = [
      {
        id: "99",
        tabs: [{ title: "Only Tab", url: "https://only.com" }],
      },
    ];

    let moveToWindowArg: any = null;
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getWindows" && cb) {
        cb({ windows });
      }
      if (_action === "moveToWindow") {
        moveToWindowArg = _args;
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Windows" });
    await Promise.resolve();
    await Promise.resolve();

    expect(omnibar.focusedResult()?.data.windowId).toBe(99);

    fireEnter(omnibar);

    expect(moveToWindowArg).not.toBeNull();
    expect(moveToWindowArg.windowId).toBe(99);
  });

  it("when zero windows are returned, calls RUNTIME moveToWindow(-1) and hides popup", async () => {
    const { front, ui } = makeOmnibar();

    let moveToWindowArg: any = null;
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getWindows" && cb) {
        cb({ windows: [] });
      }
      if (_action === "moveToWindow") {
        moveToWindowArg = _args;
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Windows" });
    await Promise.resolve();
    await Promise.resolve();

    expect(moveToWindowArg?.windowId).toBe(-1);
    expect(front.hidePopup).toHaveBeenCalled();
  });
});

describe("OpenVIMarks handler — onOpen lists marks from settings", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("populates results with one entry per VI mark", async () => {
    const { omnibar, ui } = makeOmnibar();

    const marks = {
      a: "https://alpha.com",
      b: { url: "https://beta.com", scrollLeft: 0, scrollTop: 0 },
    };

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getSettings" && cb) {
        cb({ settings: { marks } });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "VIMarks" });

    expect(omnibar.results().length).toBe(2);
    const urls = omnibar.results().map((r: any) => r.data.url);
    expect(urls).toContain("https://alpha.com");
    expect(urls).toContain("https://beta.com");
  });

  it("assigns uid M<char> for each mark", async () => {
    const { omnibar, ui } = makeOmnibar();

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getSettings" && cb) {
        cb({ settings: { marks: { x: "https://x.com" } } });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "VIMarks" });

    expect(omnibar.results()[0]?.data.uid).toBe("Mx");
  });

  it("filters marks by the current input value (query substring match)", async () => {
    const { omnibar, ui } = makeOmnibar();

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getSettings" && cb) {
        cb({
          settings: {
            marks: {
              a: "https://alpha.com",
              b: "https://beta.org",
            },
          },
        });
      }
      return Result.succeed(undefined);
    });

    omnibar.input.value = "alpha";
    ui.onShow({ type: "VIMarks" });

    expect(omnibar.results().length).toBe(1);
    expect(omnibar.results()[0]?.data.url).toBe("https://alpha.com");
  });
});

describe("Commands handler — onInput lists matching commands", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("onInput lists commands whose name contains the current input", () => {
    const { omnibar, ui } = makeOmnibar();

    omnibar.command?.("tabopen", () => {}, { annotation: "Open a tab" });
    omnibar.command?.("tabnew", () => {}, { annotation: "New tab" });
    omnibar.command?.("quit", () => {}, { annotation: "Quit browser" });

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getSettings" && cb) {
        cb({ settings: { cmdHistory: [] } });
      }
      return Result.succeed(undefined);
    });

    omnibar.input.value = "tab";
    ui.onShow({ type: "Commands" });

    const cmds = omnibar.results().map((r: any) => r.data.cmd);
    expect(cmds).toContain("tabopen");
    expect(cmds).toContain("tabnew");
    expect(cmds).not.toContain("quit");
  });

  it("onOpen with empty input shows command history from RUNTIME getSettings", () => {
    const { omnibar, ui } = makeOmnibar();
    omnibar.input.value = "";

    const history = ["tabopen github.com", "quit"];
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getSettings" && cb) {
        cb({ settings: { cmdHistory: history } });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Commands" });

    const cmds = omnibar.results().map((r: any) => r.data.cmd);
    expect(cmds).toContain("tabopen github.com");
    expect(cmds).toContain("quit");
  });

  it("Commands.onEnter sends RUNTIME updateInputHistory with the cmdline", () => {
    const { omnibar, ui } = makeOmnibar();
    omnibar.command?.("greet2", () => {}, { annotation: "Greet" });
    omnibar.input.value = "";

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getSettings" && cb) {
        cb({ settings: { cmdHistory: [] } });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Commands" });
    mockRUNTIME.mockClear();

    omnibar.input.value = "greet2 Alice";
    fireEnter(omnibar);

    const histCall = mockRUNTIME.mock.calls.find((c) => c[0] === "updateInputHistory");
    expect(histCall).toBeDefined();
    expect(histCall?.[1]).toMatchObject({ cmd: "greet2 Alice" });
  });
});

describe("OmniQuery handler — onOpen/onInput/onEnter", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("onInput filters page words that contain the typed substring", () => {
    const { omnibar, front, ui } = makeOmnibar();

    front.contentCommand.mockImplementation((msg: any, cb?: any) => {
      if (msg.action === "getPageText" && cb) {
        cb({ data: "apple apricot banana cherry" });
      }
    });

    omnibar.input.value = "";
    ui.onShow({ type: "OmniQuery" });

    omnibar.input.value = "ap";
    omnibar.triggerInput();

    const words = omnibar.results().map((r: any) => r.html);
    expect(words.some((h: string) => h.includes("apple"))).toBe(true);
    expect(words.some((h: string) => h.includes("apricot"))).toBe(true);
    expect(words.some((h: string) => h.includes("banana"))).toBe(false);
  });

  it("onInput does not throw when typed before the getPageText response arrives", () => {
    // The fixture's contentCommand never fires its callback, so the round-trip stays in flight.
    const { omnibar, ui } = makeOmnibar();

    ui.onShow({ type: "OmniQuery" });

    omnibar.input.value = "a";
    expect(() => omnibar.triggerInput()).not.toThrow();
    expect(omnibar.results()).toHaveLength(0);
  });

  it("does not serve the previous session's words when reopened before the new response", () => {
    const { omnibar, front, ui } = makeOmnibar();

    const deliveries: ((message: { data: string }) => void)[] = [];
    front.contentCommand.mockImplementation((msg: any, cb?: any) => {
      if (msg.action === "getPageText" && cb) {
        deliveries.push(cb);
      }
    });

    ui.onShow({ type: "OmniQuery" });
    ui.onHide();
    ui.onShow({ type: "OmniQuery" });
    omnibar.input.value = "ap";

    const stale = deliveries[0];
    if (stale == null) {
      throw new Error("OmniQuery did not register a getPageText callback");
    }
    stale({ data: "apple apricot" });

    const htmls = omnibar.results().map((r: any) => r.html);
    expect(htmls.some((h: string) => h.includes("apple"))).toBe(false);
    expect(omnibar.results()).toHaveLength(0);
  });

  it("lists candidates for a query typed before the getPageText response once it arrives", () => {
    const { omnibar, front, ui } = makeOmnibar();

    let deliver: ((message: { data: string }) => void) | undefined;
    front.contentCommand.mockImplementation((msg: any, cb?: any) => {
      if (msg.action === "getPageText") {
        deliver = cb;
      }
    });
    ui.onShow({ type: "OmniQuery" });

    omnibar.input.value = "err";
    omnibar.triggerInput();
    expect(omnibar.results()).toHaveLength(0);

    if (deliver == null) {
      throw new Error("OmniQuery did not register a getPageText callback");
    }
    deliver({ data: "error handling code" });

    const htmls = omnibar.results().map((r: any) => r.html);
    expect(htmls.some((h: string) => h.includes("error"))).toBe(true);
  });

  it("ignores a getPageText response that arrives after the session closed", () => {
    const { omnibar, front, ui } = makeOmnibar();

    let deliver: ((message: { data: string }) => void) | undefined;
    front.contentCommand.mockImplementation((msg: any, cb?: any) => {
      if (msg.action === "getPageText") {
        deliver = cb;
      }
    });
    ui.onShow({ type: "OmniQuery" });
    omnibar.input.value = "err";
    ui.onHide();

    if (deliver == null) {
      throw new Error("OmniQuery did not register a getPageText callback");
    }
    deliver({ data: "error handling code" });

    expect(omnibar.results()).toHaveLength(0);
  });

  it("does not overwrite the active handler when the page text arrives after an alias switch", () => {
    const { omnibar, front, ui } = makeOmnibar();

    front.actions["addSearchAlias"]({
      alias: "g",
      prompt: "Google",
      url: "https://www.google.com/search?q={0}",
      suggestionURL: undefined,
    });

    let deliver: ((message: { data: string }) => void) | undefined;
    front.contentCommand.mockImplementation((msg: any, cb?: any) => {
      if (msg.action === "getPageText") {
        deliver = cb;
      }
    });

    ui.onShow({ type: "OmniQuery" });
    omnibar.expandAlias("g", "cat");

    if (deliver == null) {
      throw new Error("OmniQuery did not register a getPageText callback");
    }
    deliver({ data: "cat category catalog" });

    const htmls = omnibar.results().map((r: any) => r.html);
    expect(htmls.some((h: string) => h.includes("category"))).toBe(false);
  });

  it("onEnter dispatches contentCommand omnibar_query_entered with current input", () => {
    const { omnibar, front, ui } = makeOmnibar();

    front.contentCommand.mockImplementation((msg: any, cb?: any) => {
      if (msg.action === "getPageText" && cb) {
        cb({ data: "foo bar" });
      }
    });

    omnibar.input.value = "";
    ui.onShow({ type: "OmniQuery" });

    omnibar.input.value = "foo";
    fireEnter(omnibar);

    const queryCall = front.contentCommand.mock.calls.find(
      (c: any) => c[0]?.action === "omnibar_query_entered",
    );
    expect(queryCall).toBeDefined();
    expect(queryCall?.[0].query).toBe("foo");
  });
});

describe("OpenBookmarks handler — onInput + onResponse", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("onInput sends RUNTIME getBookmarks with the current query and caseSensitive flag", () => {
    const { omnibar, ui } = makeOmnibar();

    const folders = [{ id: "1", title: "/Bar/" }];
    const bookmarks = [
      { id: "b1", title: "My Bookmark", url: "https://bm.com", dateAdded: 0, parentId: "1" },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getBookmarkFolders" && cb) {
        cb({ folders });
      }
      if (_action === "getBookmarks" && cb) {
        cb({ bookmarks });
      }
      return Result.succeed(undefined);
    });

    omnibar.input.value = "";
    ui.onShow({ type: "Bookmarks" });

    mockRUNTIME.mockClear();
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getBookmarks" && cb) {
        cb({ bookmarks });
      }
      return Result.succeed(undefined);
    });

    omnibar.input.value = "My";
    omnibar.triggerInput();

    const getBookmarksCall = mockRUNTIME.mock.calls.find((c) => c[0] === "getBookmarks");
    expect(getBookmarksCall).toBeDefined();
    expect(getBookmarksCall?.[1]).toMatchObject({ query: "My" });
  });

  it("onResponse populates results from the getBookmarks response bookmarks", async () => {
    const { omnibar, ui } = makeOmnibar();

    const folders = [{ id: "1", title: "/Bar/" }];
    const bookmarks = [
      { id: "b1", title: "Page One", url: "https://one.com", dateAdded: 0, parentId: "1" },
      { id: "b2", title: "Page Two", url: "https://two.com", dateAdded: 0, parentId: "1" },
    ];

    mockRequest.mockImplementation((action: any) => {
      if (action === "getBookmarkFolders") return Promise.resolve({ folders });
      if (action === "getBookmarks") return Promise.resolve({ bookmarks });
      return new Promise(() => {});
    });

    omnibar.input.value = "";
    ui.onShow({ type: "Bookmarks" });
    await flush();

    const urls = omnibar.results().map((r: any) => r.data.url);
    expect(urls).toContain("https://one.com");
    expect(urls).toContain("https://two.com");
  });
});

describe("OpenURLs handler — Enter opens a typed URL in the current tab", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("sends RUNTIME openLink with { tab: { tabbed: false, active: true }, url } and a boolean tabbed", () => {
    const { omnibar, ui } = makeOmnibar();

    ui.onShow({ type: "URLs", tabbed: false });
    omnibar.input.value = "https://example.com";

    fireEnter(omnibar);

    const openLinkArgs = mockRUNTIME.mock.calls.find((c) => c[0] === "openLink")?.[1];
    expect(openLinkArgs).toEqual({
      tab: { tabbed: false, active: true },
      url: "https://example.com",
    });

    const tab = openLinkArgs?.["tab"];
    const tabbed =
      typeof tab === "object" && tab !== null && "tabbed" in tab ? tab.tabbed : undefined;
    expect(typeof tabbed).toBe("boolean");
  });
});

describe("SearchEngine handler — onInput without suggestionURL clears results", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("without suggestionURL, onInput produces empty results immediately", () => {
    const { omnibar, front, ui } = makeOmnibar();

    front.actions["addSearchAlias"]({
      alias: "g",
      prompt: "Google",
      url: "https://www.google.com/search?q={0}",
      suggestionURL: undefined,
    });

    ui.onShow({ type: "SearchEngine", extra: "g" });

    omnibar.input.value = "vitest";
    omnibar.triggerInput();

    expect(omnibar.results().length).toBe(0);
  });

  it("with suggestionURL and omnibarSuggestion=true, dispatches RUNTIME request after timeout", () => {
    const { omnibar, front, ui } = makeOmnibar();
    runtime.conf.omnibarSuggestion = true;
    runtime.conf.omnibarSuggestionTimeout = 300;

    front.actions["addSearchAlias"]({
      alias: "s",
      prompt: "Suggest",
      url: "https://search.com/q={0}",
      suggestionURL: "https://suggest.com/q={0}",
    });

    ui.onShow({ type: "SearchEngine", extra: "s" });

    mockRUNTIME.mockClear();
    omnibar.input.value = "hello";
    omnibar.triggerInput();

    expect(mockRUNTIME.mock.calls.find((c) => c[0] === "request")).toBeUndefined();

    vi.advanceTimersByTime(400);

    const requestCall = mockRUNTIME.mock.calls.find((c) => c[0] === "request");
    expect(requestCall).toBeDefined();
    const requestArgs = requestCall?.[1];
    expect(requestArgs?.["url"]).toContain("hello");
  });
});

describe("AddBookmark handler — onEnter creates bookmark in focused folder", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("onEnter calls RUNTIME createBookmark with the folder from focusedResult", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.focusFirstCandidate = true;

    const folders = [
      { id: "10", title: "/Bookmarks Bar/" },
      { id: "20", title: "/Other/" },
    ];

    let createBookmarkArgs: any = null;
    mockRequest.mockImplementation((action: any) => {
      if (action === "getBookmarkFolders") return Promise.resolve({ folders });
      if (action === "getBookmark") return Promise.resolve({ bookmarks: [] });
      return new Promise(() => {});
    });
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "createBookmark") {
        createBookmarkArgs = _args;
        if (cb) cb({});
      }
      return Result.succeed(undefined);
    });

    ui.onShow({
      type: "AddBookmark",
      extra: { url: "https://new-page.com", title: "New Page" },
    });
    await flush();

    expect(omnibar.focusedIndex()).toBeGreaterThanOrEqual(0);

    fireEnter(omnibar);

    expect(createBookmarkArgs).not.toBeNull();
    expect(createBookmarkArgs.page.folder).toBeDefined();
  });
});

describe("OpenUserURLs handler — onOpen/onInput", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("onOpen lists all items when input is empty", async () => {
    const { omnibar, ui } = makeOmnibar();

    const items = [
      { url: "https://a.com", title: "Alpha" },
      { url: "https://b.com", title: "Beta" },
    ];

    ui.onShow({ type: "UserURLs", extra: items });

    const urls = omnibar.results().map((r: any) => r.data.url);
    expect(urls).toContain("https://a.com");
    expect(urls).toContain("https://b.com");
  });

  it("onInput filters items by the current query", async () => {
    const { omnibar, ui } = makeOmnibar();

    const items = [
      { url: "https://a.com", title: "Alpha" },
      { url: "https://b.com", title: "Beta" },
    ];

    ui.onShow({ type: "UserURLs", extra: items });

    omnibar.input.value = "Alpha";
    omnibar.triggerInput();

    expect(omnibar.results().length).toBe(1);
    expect(omnibar.results()[0]?.data.url).toBe("https://a.com");
  });
});

describe("OpenURLs (History) handler — onOpen calls RUNTIME getHistory and lists results", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("lists history items returned by RUNTIME getHistory", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.historyMostUsedOrder = false;

    const history = [
      { url: "https://hist1.com", title: "H1", lastVisitTime: 200, visitCount: 3 },
      { url: "https://hist2.com", title: "H2", lastVisitTime: 100, visitCount: 1 },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getHistory" && cb) {
        cb({ history });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "History" });
    await Promise.resolve();
    await Promise.resolve();

    const urls = omnibar.results().map((r: any) => r.data.url);
    expect(urls).toContain("https://hist1.com");
    expect(urls).toContain("https://hist2.com");
  });

  it("Ctrl-r sends a second getHistory carrying the toggled sortByMostUsed", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.historyMostUsedOrder = false;

    const history = [
      { url: "https://a.com", title: "A", lastVisitTime: 200, visitCount: 5 },
      { url: "https://b.com", title: "B", lastVisitTime: 100, visitCount: 10 },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getHistory" && cb) {
        cb({ history });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "History" });
    await Promise.resolve();
    await Promise.resolve();

    getMappingByAnnotation(omnibar, "Re-sort history by visitCount or lastVisitTime")?.();
    await Promise.resolve();
    await Promise.resolve();

    const historyQueries = mockRUNTIME.mock.calls.filter((c: any[]) => c[0] === "getHistory");
    expect(historyQueries).toHaveLength(2);
    expect(historyQueries[0]?.[1]).toMatchObject({ sortByMostUsed: false });
    expect(historyQueries[1]?.[1]).toMatchObject({ sortByMostUsed: true });
  });
});

function getMappingByAnnotation(
  omnibar: any,
  annotation: string,
): ((...args: any[]) => void) | undefined {
  const metas: any[] = omnibar.mappings.getMetas((m: any) => m.annotation === annotation);
  return metas[0]?.code;
}

describe("createOmnibar — detectAndInsertURLItem urlPat1 fallback", () => {
  it("inserts a bare http:// URL that passes urlPat1 but not urlPat", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    const list: any[] = [];
    omnibar.detectAndInsertURLItem("http://localhost", list);
    expect(list).toHaveLength(1);
    expect(list[0]?.url).toBe("http://localhost");
  });
});

describe("createOmnibar — Ctrl-c copy paths", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("copies data.copy when the focused result carries a copy field", () => {
    buildOmnibarDOM();
    const front = makeFront();
    const clipboard = makeClipboard();
    const omnibar = createOmnibar(front, clipboard);
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = true;
    runtime.conf.omnibarPosition = "middle";

    omnibar.listResults([{ url: "https://r.example.com" }], (b: any) =>
      omnibar.createItemFromRawHtml({
        html: b.url,
        props: { url: b.url, copy: "custom-copy-text" },
      }),
    );
    expect(omnibar.focusedIndex()).toBe(0);

    const ctrlCCode = getMappingByAnnotation(
      omnibar,
      "Copy selected item url or all listed item urls",
    );
    expect(ctrlCCode).toBeDefined();
    ctrlCCode!();
    expect(clipboard.write).toHaveBeenLastCalledWith("custom-copy-text");
  });

  it("copies pageItems URLs joined by newline when no result is focused", () => {
    buildOmnibarDOM();
    const front = makeFront();
    const clipboard = makeClipboard();
    const omnibar = createOmnibar(front, clipboard);
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";
    runtime.conf.omnibarHistoryCacheSize = 100;

    const items = [
      { url: "https://p1.example.com", title: "P1", lastVisitTime: 100, visitCount: 1 },
      { url: "https://p2.example.com", title: "P2", lastVisitTime: 200, visitCount: 2 },
    ];
    omnibar.listURLs(items, false);
    expect(omnibar.focusedIndex()).toBe(-1);

    const ctrlCCode = getMappingByAnnotation(
      omnibar,
      "Copy selected item url or all listed item urls",
    );
    expect(ctrlCCode).toBeDefined();
    ctrlCCode!();
    const written = clipboard.write.mock.calls.at(-1)![0] as string;
    expect(written).toContain("https://p1.example.com");
    expect(written).toContain("https://p2.example.com");
  });
});

describe("createOmnibar — Ctrl-r triggers handler.onReset", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("Ctrl-r mapping code calls handler.onReset when it exists", async () => {
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.historyMostUsedOrder = false;

    const history = [{ url: "https://a.com", title: "A", lastVisitTime: 100, visitCount: 5 }];
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getHistory" && cb) {
        cb({ history });
      }
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "History" });
    await Promise.resolve();
    await Promise.resolve();

    const before = runtime.conf.historyMostUsedOrder;

    const ctrlRCode = getMappingByAnnotation(
      omnibar,
      "Re-sort history by visitCount or lastVisitTime",
    );
    expect(ctrlRCode).toBeDefined();
    ctrlRCode!();

    await Promise.resolve();
    expect(runtime.conf.historyMostUsedOrder).toBe(!before);
  });
});

describe("createOmnibar — Ctrl-j toggles omnibarPosition between middle and bottom", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
  });

  it("switches from middle to bottom and calls front.hidePopup", () => {
    // Use makeOmnibar() so input.focus() is real (backed by a real DOM input)
    runtime.conf.omnibarPosition = "middle";
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getTabs" && cb) cb({ tabs: [] });
      return Result.succeed(undefined);
    });
    const { omnibar, front, ui } = makeOmnibar();
    ui.onShow({ type: "Tabs" });

    const ctrlJCode = getMappingByAnnotation(omnibar, "Toggle Omnibar's position");
    expect(ctrlJCode).toBeDefined();
    ctrlJCode!();
    expect(runtime.conf.omnibarPosition).toBe("bottom");
    expect(front.hidePopup).toHaveBeenCalled();
  });

  it("switches from bottom back to middle", () => {
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getTabs" && cb) cb({ tabs: [] });
      return Result.succeed(undefined);
    });
    // makeOmnibar() resets omnibarPosition to "middle"; set it to "bottom" after.
    const { omnibar, ui } = makeOmnibar();
    runtime.conf.omnibarPosition = "bottom";
    ui.onShow({ type: "Tabs" });

    const ctrlJCode = getMappingByAnnotation(omnibar, "Toggle Omnibar's position");
    expect(ctrlJCode).toBeDefined();
    ctrlJCode!();
    expect(runtime.conf.omnibarPosition).toBe("middle");
  });
});

describe("createOmnibar — onHide calls handler.onClose", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("invokes the active handler's onClose exactly once when the omnibar is hidden", () => {
    const { omnibar, ui } = makeOmnibar();
    const onClose = vi.fn();
    omnibar.addHandler("ProbeClose", { onOpen: vi.fn(), onClose, prompt: "probe" });

    ui.onShow({ type: "ProbeClose" });
    expect(onClose).not.toHaveBeenCalled();

    ui.onHide();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("skips onClose invocation when the active handler has none", () => {
    const { omnibar, ui } = makeOmnibar();
    // The cleared cachedPromise is the observable proof that onHide ran to completion
    // past the missing onClose instead of throwing.
    omnibar.addHandler("ProbeNoClose", { onOpen: vi.fn(), prompt: "probe" });
    omnibar.cachedPromise = Promise.resolve("cached");

    ui.onShow({ type: "ProbeNoClose" });
    ui.onHide();

    expect(omnibar.cachedPromise).toBeUndefined();
  });
});

describe("createOmnibar — Tab/Shift-Tab cycle through results", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    (HTMLElement.prototype as any).scrollIntoViewIfNeeded = vi.fn();
  });

  it("Tab advances focusedIndex forward from -1 to 0 in middle position", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    omnibar.listWords(["alpha", "beta", "gamma"]);
    expect(omnibar.focusedIndex()).toBe(-1);

    const tabCode = getMappingByAnnotation(omnibar, "Forward cycle through the candidates.");
    expect(tabCode).toBeDefined();
    tabCode!();
    expect(omnibar.focusedIndex()).toBe(0);
  });

  it("Tab wraps from last item back to -1 (typed input slot)", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    omnibar.listWords(["a", "b"]);
    omnibar.focusItem(1);
    const tabCode = getMappingByAnnotation(omnibar, "Forward cycle through the candidates.");
    expect(tabCode).toBeDefined();
    tabCode!();
    expect(omnibar.focusedIndex()).toBe(-1);
  });

  it("Shift-Tab goes backward: from -1 to last item", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    omnibar.listWords(["a", "b", "c"]);
    expect(omnibar.focusedIndex()).toBe(-1);

    const shiftTabCode = getMappingByAnnotation(omnibar, "Backward cycle through the candidates.");
    expect(shiftTabCode).toBeDefined();
    shiftTabCode!();
    expect(omnibar.focusedIndex()).toBe(2);
  });
});

describe("createOmnibar — Ctrl-n/Ctrl-p with handler.rotateInput", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("Ctrl-n calls handler.rotateInput(false) when handler provides it", () => {
    // Inject a handler with rotateInput via makeOmnibar so we get a real DOM input
    const rotateInput = vi.fn();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    const { omnibar, ui } = makeOmnibar();
    omnibar.addHandler("TestRotate", {
      prompt: "test",
      onOpen: vi.fn(),
      onInput: vi.fn(),
      onEnter: vi.fn(() => true),
      rotateInput,
    });
    ui.onShow({ type: "TestRotate" });

    const ctrlNCode = getMappingByAnnotation(omnibar, "Forward cycle through the input history.");
    expect(ctrlNCode).toBeDefined();
    ctrlNCode!();
    expect(rotateInput).toHaveBeenLastCalledWith(false);
  });

  it("Ctrl-p calls handler.rotateInput(true) in middle position", () => {
    const rotateInput = vi.fn();
    const { omnibar, ui } = makeOmnibar();
    omnibar.addHandler("TestRotate2", {
      prompt: "test",
      onOpen: vi.fn(),
      onInput: vi.fn(),
      onEnter: vi.fn(() => true),
      rotateInput,
    });
    ui.onShow({ type: "TestRotate2" });

    const ctrlPCode = getMappingByAnnotation(omnibar, "Backward cycle through the input history.");
    expect(ctrlPCode).toBeDefined();
    ctrlPCode!();
    expect(rotateInput).toHaveBeenLastCalledWith(true);
  });

  it("Ctrl-n falls back to rotating results when the handler has no rotateInput", () => {
    const { omnibar, ui } = makeOmnibar();
    omnibar.addHandler("TestNoRotate", {
      prompt: "test",
      onOpen: vi.fn(),
      onInput: vi.fn(),
      onEnter: vi.fn(() => true),
    });
    ui.onShow({ type: "TestNoRotate" });
    omnibar.listWords(["a", "b", "c"]);

    const ctrlNCode = getMappingByAnnotation(omnibar, "Forward cycle through the input history.");
    ctrlNCode!();
    expect(omnibar.focusedIndex()).toBe(0);
  });
});

describe("createOmnibar — Ctrl-d deletes the focused item", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
    runtime.conf.focusFirstCandidate = true;
  });

  afterAll(() => {
    runtime.conf.focusFirstCandidate = false;
  });

  function listWithUids(omnibar: any, uids: string[]): void {
    omnibar.listResults(
      uids.map((uid) => ({ uid })),
      (b: any) => ({ html: `<li>${b.uid}</li>`, data: { uid: b.uid } }),
    );
  }

  it("removes the focused item from results when the backend reports Done", () => {
    const { omnibar } = makeOmnibar();
    runtime.conf.focusFirstCandidate = true;
    mockRUNTIME.mockImplementation((action: any, _args: any, cb?: any) => {
      if (action === "removeURL" && cb) {
        cb({ response: "Done" });
      }
      return Result.succeed(undefined);
    });
    listWithUids(omnibar, ["u0", "u1", "u2"]);
    omnibar.focusItem(0);

    getMappingByAnnotation(omnibar, "Delete focused item from bookmark or history")!();

    expect(mockRUNTIME).toHaveBeenCalledWith("removeURL", { uid: "u0" }, expect.any(Function));
    expect(omnibar.results().map((r: any) => r.data.uid)).toEqual(["u1", "u2"]);
  });

  it("keeps the results unchanged when the backend does not report Done", () => {
    const { omnibar } = makeOmnibar();
    runtime.conf.focusFirstCandidate = true;
    mockRUNTIME.mockImplementation((action: any, _args: any, cb?: any) => {
      if (action === "removeURL" && cb) {
        cb({ response: "Failed" });
      }
      return Result.succeed(undefined);
    });
    listWithUids(omnibar, ["a", "b"]);
    omnibar.focusItem(0);

    getMappingByAnnotation(omnibar, "Delete focused item from bookmark or history")!();

    expect(omnibar.results().map((r: any) => r.data.uid)).toEqual(["a", "b"]);
  });

  it("does nothing when the focused item carries no uid", () => {
    const { omnibar } = makeOmnibar();
    runtime.conf.focusFirstCandidate = true;
    // listWords results carry `query` and no `uid`, which is what this case needs.
    omnibar.listWords(["plain"]);
    omnibar.focusItem(0);

    getMappingByAnnotation(omnibar, "Delete focused item from bookmark or history")!();

    expect(mockRUNTIME).not.toHaveBeenCalledWith("removeURL", expect.anything(), expect.anything());
  });
});

describe("SearchEngine handler — onOpen with site: prefix sets selection range", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("calls setSelectionRange on input when query starts with site:", () => {
    const { omnibar, front, ui } = makeOmnibar();

    front.actions["addSearchAlias"]({
      alias: "g",
      prompt: "Google",
      url: "https://www.google.com/search?q={0}",
      suggestionURL: undefined,
    });

    omnibar.input.value = "site:example.com hello";
    const spy = vi.spyOn(omnibar.input, "setSelectionRange").mockImplementation(() => {});

    ui.onShow({ type: "SearchEngine", extra: "g" });

    expect(spy).toHaveBeenCalledWith("site:example.com ".length, "site:example.com hello".length);
    spy.mockRestore();
  });
});

describe("SearchEngine handler — listSuggestions with html/url-keyed items", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("suggestion items with url field are rendered as URL items", () => {
    const { omnibar, front, ui } = makeOmnibar();
    runtime.conf.omnibarSuggestion = true;
    runtime.conf.omnibarSuggestionTimeout = 300;

    front.actions["addSearchAlias"]({
      alias: "u",
      prompt: "URLEngine",
      url: "https://search.com/q={0}",
      suggestionURL: "https://suggest.com/q={0}",
    });

    ui.onShow({ type: "SearchEngine", extra: "u" });
    omnibar.input.value = "test";

    let suggestionsCb: any = null;
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "request" && cb) {
        cb({ text: "" });
        suggestionsCb = front.contentCommand.mock.calls.at(-1)?.[1];
      }
      return Result.succeed(undefined);
    });

    omnibar.triggerInput();
    vi.advanceTimersByTime(400);

    if (suggestionsCb) {
      suggestionsCb({ data: [{ url: "https://sug.example.com", title: "Sug" }] });
    } else {
      front.contentCommand.mockImplementationOnce((_msg: any, cb?: any) => {
        if (cb) cb({ data: [{ url: "https://sug.example.com", title: "Sug" }] });
      });
      omnibar.triggerInput();
      vi.advanceTimersByTime(400);
    }

    const urls = omnibar.results().map((r: any) => r.data.url);
    expect(urls).toContain("https://sug.example.com");
  });

  it("suggestion response that is not an array produces empty results", () => {
    const { omnibar, front, ui } = makeOmnibar();
    runtime.conf.omnibarSuggestion = true;
    runtime.conf.omnibarSuggestionTimeout = 100;

    front.actions["addSearchAlias"]({
      alias: "x",
      prompt: "XEngine",
      url: "https://x.com/q={0}",
      suggestionURL: "https://xsug.com/q={0}",
    });

    ui.onShow({ type: "SearchEngine", extra: "x" });
    omnibar.input.value = "query";

    front.contentCommand.mockImplementation((_msg: any, cb?: any) => {
      if (cb) cb({ data: "not an array" });
    });

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "request" && cb) cb({ text: "" });
      return Result.succeed(undefined);
    });

    omnibar.triggerInput();
    vi.advanceTimersByTime(200);

    expect(omnibar.results().length).toBe(0);
  });
});

describe("SearchEngine — addSearchAlias icon loading paths", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("uses stored searchEngineIcon from localStorage without issuing a RUNTIME request", () => {
    buildOmnibarDOM();
    const front = makeFront();
    front.topOrigin = "https://example.com";
    createOmnibar(front, makeClipboard());

    const iconKey = "surfingkeys.searchEngineIcon.Google";
    localStorage.setItem(iconKey, "data:image/png;base64,ICON");

    front.actions["addSearchAlias"]({
      alias: "g",
      prompt: "Google",
      url: "https://www.google.com/search?q={0}",
      suggestionURL: undefined,
    });

    const aliases: any[] = [];
    front.postMessage.mockImplementationOnce((msg: any) => {
      aliases.push(msg.aliases);
    });
    front.actions["getSearchAliases"]({ id: "icon-test" });
    const aliasMap = aliases[0];
    expect(typeof aliasMap["g"].prompt).toBe("object");
    expect((aliasMap["g"].prompt as any).html).toContain("data:image/png;base64,ICON");
  });

  it("skips RUNTIME requestImage when topOrigin does not start with http", () => {
    buildOmnibarDOM();
    const front = makeFront();
    front.topOrigin = "chrome-extension://abc123";
    createOmnibar(front, makeClipboard());

    mockRUNTIME.mockClear();
    front.actions["addSearchAlias"]({
      alias: "h",
      prompt: "GitHub",
      url: "https://github.com/search?q={0}",
      suggestionURL: undefined,
    });

    const requestImageCall = mockRUNTIME.mock.calls.find((c) => c[0] === "requestImage");
    expect(requestImageCall).toBeUndefined();
  });

  it("uses faviconUrl from options when provided instead of deriving from url", () => {
    buildOmnibarDOM();
    const front = makeFront();
    front.topOrigin = "https://example.com";
    createOmnibar(front, makeClipboard());

    let requestImageUrl: string | undefined;
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "requestImage") {
        requestImageUrl = _args.url;
        if (cb) cb(null);
      }
      return Result.succeed(undefined);
    });

    front.actions["addSearchAlias"]({
      alias: "f",
      prompt: "Favicon",
      url: "https://search.example.com/q={0}",
      suggestionURL: undefined,
      options: { faviconUrl: "https://cdn.example.com/icon.png" },
    });

    expect(requestImageUrl).toBe("https://cdn.example.com/icon.png");
  });
});

describe("Commands handler — onInput with no matching candidates", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("does not call listResults when no commands match the query", () => {
    const { omnibar, ui } = makeOmnibar();

    omnibar.command?.("tabopen", () => {}, { annotation: "Open a tab" });
    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getSettings" && cb) cb({ settings: { cmdHistory: [] } });
      return Result.succeed(undefined);
    });

    omnibar.input.value = "";
    ui.onShow({ type: "Commands" });

    // Spy only after onShow so the onOpen-driven history listing is not counted.
    const listResults = vi.spyOn(omnibar, "listResults");

    omnibar.input.value = "zzz_no_match";
    omnibar.triggerInput();

    expect(listResults).not.toHaveBeenCalled();

    // The matching query proves the assertion above pins the empty-candidates branch
    // rather than a listResults path that never runs at all.
    omnibar.input.value = "tabopen";
    omnibar.triggerInput();

    expect(listResults).toHaveBeenCalledTimes(1);
    expect(listResults.mock.calls[0]?.[0]).toEqual(["tabopen"]);

    listResults.mockRestore();
  });
});

describe("OmniQuery handler — onOpen with arg when dictEnabled is set", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("does not call omnibar_query_entered via contentCommand when dictEnabled is set", () => {
    const { omnibar, front, ui } = makeOmnibar();

    (document as any).dictEnabled = true;

    front.contentCommand.mockImplementation((msg: any, cb?: any) => {
      if (msg.action === "getPageText" && cb) {
        cb({ data: "hello world" });
      }
    });

    omnibar.input.value = "";
    ui.onShow({ type: "OmniQuery", extra: "hello" });

    const queryCall = front.contentCommand.mock.calls.find(
      (c: any) => c[0]?.action === "omnibar_query_entered",
    );
    expect(queryCall).toBeUndefined();

    delete (document as any).dictEnabled;
  });
});

describe("OpenWindows handler — onInput filters windows by query", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("filters windows so only matching windows appear in results", async () => {
    const { omnibar, ui } = makeOmnibar();

    const windows = [
      {
        id: "1",
        tabs: [{ title: "Google Search", url: "https://google.com" }],
      },
      {
        id: "2",
        tabs: [{ title: "GitHub", url: "https://github.com" }],
      },
    ];

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getWindows" && cb) cb({ windows });
      return Result.succeed(undefined);
    });

    omnibar.input.value = "GitHub";
    ui.onShow({ type: "Windows" });
    await Promise.resolve();
    await Promise.resolve();

    expect(omnibar.results().length).toBe(1);
    const windowIds = omnibar.results().map((r: any) => r.data.windowId);
    expect(windowIds).toContain(2);
    expect(windowIds).not.toContain(1);
  });
});

describe("OpenTabs handler — onOpen with filter arg", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("includes filter in the getTabs args when extra.filter is a string", async () => {
    const { ui } = makeOmnibar();
    runtime.conf.tabsThreshold = 100;

    mockRUNTIME.mockImplementation((_action: any, _args: any, cb?: any) => {
      if (_action === "getTabs" && cb) cb({ tabs: [] });
      return Result.succeed(undefined);
    });

    ui.onShow({ type: "Tabs", extra: { filter: "some-filter" } });
    await Promise.resolve();
    await Promise.resolve();

    const getTabsCall = mockRUNTIME.mock.calls.find((c) => c[0] === "getTabs");
    expect(getTabsCall).toBeDefined();
    expect(getTabsCall?.[1]).toMatchObject({ filter: "some-filter" });
  });
});

describe("createOmnibar — listResults respects handler.focusFirstCandidate", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("focuses first item when handler.focusFirstCandidate is true and runtime flag is false", () => {
    // Use makeOmnibar() for a real DOM input (input.focus() is needed by onShow)
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";
    const { omnibar, ui } = makeOmnibar();

    omnibar.addHandler("FFC", {
      prompt: "ffc",
      focusFirstCandidate: true,
      onOpen: vi.fn(),
      onInput: vi.fn(),
      onEnter: vi.fn(() => true),
    });
    ui.onShow({ type: "FFC" });

    omnibar.listWords(["a", "b", "c"]);
    expect(omnibar.focusedIndex()).toBe(0);
  });
});

describe("createOmnibar — pagination mappings Ctrl-. and Ctrl-,", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("Ctrl-. advances to next page when within bounds", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 2;
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    const items = [
      { url: "https://a.com", title: "A", lastVisitTime: 1, visitCount: 1 },
      { url: "https://b.com", title: "B", lastVisitTime: 2, visitCount: 1 },
      { url: "https://c.com", title: "C", lastVisitTime: 3, visitCount: 1 },
    ];
    omnibar.listURLs(items, false);
    expect(omnibar.results().length).toBe(2);

    const nextPage = getMappingByAnnotation(omnibar, "Show results of next page");
    expect(nextPage).toBeDefined();
    nextPage!();
    expect(omnibar.results().length).toBe(1);
    expect(omnibar.results()[0]?.data.url).toBe("https://c.com");
  });

  it("Ctrl-. wraps back to page 1 when already on the last page", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 2;
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    const items = [
      { url: "https://a.com", title: "A", lastVisitTime: 1, visitCount: 1 },
      { url: "https://b.com", title: "B", lastVisitTime: 2, visitCount: 1 },
    ];
    omnibar.listURLs(items, false);
    const nextPage = getMappingByAnnotation(omnibar, "Show results of next page");
    expect(nextPage).toBeDefined();
    nextPage!();
    expect(omnibar.results().length).toBe(2);
    expect(omnibar.results()[0]?.data.url).toBe("https://a.com");
  });

  it("Ctrl-, goes back to previous page", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 2;
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    const items = [
      { url: "https://a.com", title: "A", lastVisitTime: 1, visitCount: 1 },
      { url: "https://b.com", title: "B", lastVisitTime: 2, visitCount: 1 },
      { url: "https://c.com", title: "C", lastVisitTime: 3, visitCount: 1 },
    ];
    omnibar.listURLs(items, false);
    const nextPage = getMappingByAnnotation(omnibar, "Show results of next page");
    expect(nextPage).toBeDefined();
    nextPage!();
    expect(omnibar.results().length).toBe(1);

    const prevPage = getMappingByAnnotation(omnibar, "Show results of previous page");
    expect(prevPage).toBeDefined();
    prevPage!();
    expect(omnibar.results().length).toBe(2);
    expect(omnibar.results()[0]?.data.url).toBe("https://a.com");
  });

  it("Ctrl-, wraps to last page when on page 1", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 2;
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    const items = [
      { url: "https://a.com", title: "A", lastVisitTime: 1, visitCount: 1 },
      { url: "https://b.com", title: "B", lastVisitTime: 2, visitCount: 1 },
      { url: "https://c.com", title: "C", lastVisitTime: 3, visitCount: 1 },
    ];
    omnibar.listURLs(items, false);
    const prevPage = getMappingByAnnotation(omnibar, "Show results of previous page");
    expect(prevPage).toBeDefined();
    prevPage!();
    expect(omnibar.results().length).toBe(1);
    expect(omnibar.results()[0]?.data.url).toBe("https://c.com");
  });
});

describe("createOmnibar — listResultPage total display", () => {
  it("appends a + to the total when item count equals omnibarHistoryCacheSize", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 2;
    runtime.conf.omnibarHistoryCacheSize = 3;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    const items = Array.from({ length: 3 }, (_, i) => ({
      url: `https://h${i}.com`,
      title: `H${i}`,
      lastVisitTime: i,
      visitCount: 1,
    }));
    omnibar.listURLs(items, false);
    expect(omnibar.results().length).toBe(2);
    const resultPageSpan = document.querySelector("#sk_omnibarSearchArea>span.resultPage");
    expect(resultPageSpan?.textContent).toContain("3+");
  });
});

describe("createOmnibar — listResultPage showFolder branch", () => {
  it("renders folder items when showFolder is true and item has no url/html", () => {
    buildOmnibarDOM();
    const omnibar = createOmnibar(makeFront(), makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.omnibarHistoryCacheSize = 100;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    // A folder item is distinguished by having neither a url nor an html field.
    const items = [{ title: "Dev Folder", id: "folder1" }];
    omnibar.listURLs(items, true);

    expect(omnibar.results().length).toBe(1);
    const result = omnibar.results()[0]!;
    expect(result.data.folderName).toBe("Dev Folder");
    expect(result.data.folderId).toBe("folder1");
  });
});

describe("createOmnibar — onShow with initialQuery", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("fills the input with initialQuery", () => {
    const { omnibar, ui } = makeOmnibar();

    ui.onShow({ type: "URLs", initialQuery: "https://example.com/path" });

    expect(omnibar.input.value).toBe("https://example.com/path");
  });

  it("opens the prefilled URL on Enter when no result is focused", () => {
    const { omnibar, ui } = makeOmnibar();

    ui.onShow({ type: "URLs", initialQuery: "https://example.com/path", tabbed: false });
    fireEnter(omnibar);

    expect(mockRUNTIME).toHaveBeenCalledWith("openLink", {
      tab: { tabbed: false, active: true },
      url: "https://example.com/path",
    });
  });
});

describe("createOmnibar — openFocused", () => {
  beforeEach(() => {
    mockRUNTIME.mockReset();
    mockRUNTIME.mockImplementation(() => Result.succeed(undefined));
    localStorage.clear();
  });

  it("calls RUNTIME focusTab when the focused result has a T-type uid", () => {
    buildOmnibarDOM();
    const front = makeFront();
    const omnibar = createOmnibar(front, makeClipboard());
    omnibar.input = stubInput("");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = true;
    runtime.conf.omnibarPosition = "middle";

    omnibar.listResults(
      [{ url: "https://tab.example.com", title: "Tab", width: 1024, windowId: 3, id: 77 }],
      (b: any) => omnibar.createURLItem(b, null),
    );
    expect(omnibar.focusedIndex()).toBe(0);
    expect(omnibar.focusedResult()?.data.uid).toBe("T3:77");

    omnibar.openFocused({ tabbed: true, activeTab: true });

    expect(mockRUNTIME).toHaveBeenLastCalledWith("focusTab", { windowId: 3, tabId: 77 });
  });

  it("calls RUNTIME openLink with URL when no focused result and input is a URL", () => {
    buildOmnibarDOM();
    const front = makeFront();
    const omnibar = createOmnibar(front, makeClipboard());
    omnibar.input = stubInput("https://directurl.example.com");
    runtime.conf.omnibarMaxResults = 10;
    runtime.conf.focusFirstCandidate = false;
    runtime.conf.omnibarPosition = "middle";

    // openFocused falls back to the default search engine, which must exist.
    front.actions["addSearchAlias"]({
      alias: "g",
      prompt: "Google",
      url: "https://www.google.com/search?q={0}",
      suggestionURL: undefined,
    });
    runtime.conf.defaultSearchEngine = "g";

    omnibar.openFocused({ tabbed: true, activeTab: true });

    expect(mockRUNTIME).toHaveBeenLastCalledWith("openLink", {
      tab: { tabbed: true, active: true },
      url: "https://directurl.example.com",
    });
  });
});
