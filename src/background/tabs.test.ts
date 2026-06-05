import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../test/helpers";
import { _fixTo, _roundBase, createTabs } from "./tabs";

type AnyChrome = {
  tabs?: any;
  windows?: any;
  commands?: any;
  sessions?: any;
  scripting?: any;
  runtime?: any;
};
const g = globalThis as unknown as { chrome: AnyChrome };

afterEach(() => {
  delete g.chrome.tabs;
  delete g.chrome.windows;
  delete g.chrome.commands;
  delete g.chrome.sessions;
  delete g.chrome.scripting;
  delete g.chrome.runtime;
});

describe("_fixTo", () => {
  it("clamps a negative target up to 0", () => {
    expect(_fixTo(-3, 10)).toBe(0);
  });

  it("leaves an in-range target untouched", () => {
    expect(_fixTo(4, 10)).toBe(4);
  });

  it("clamps an over-range target down to length", () => {
    expect(_fixTo(10, 10)).toBe(10);
    expect(_fixTo(15, 10)).toBe(10);
  });
});

describe("_roundBase", () => {
  it("leaves the base when the repeat count fits ahead", () => {
    expect(_roundBase(2, 3, 10)).toBe(2);
  });

  it("rounds the base back when the repeat count would overrun the length", () => {
    expect(_roundBase(8, 5, 10)).toBe(5);
    expect(_roundBase(9, 3, 10)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Shared chrome stub factory
// ---------------------------------------------------------------------------

type TabsStub = {
  onRemoved: any;
  onUpdated: any;
  onCreated: any;
  onMoved: any;
  onActivated: any;
  onDetached: any;
  onAttached: any;
  query: any;
  update: any;
  create?: any;
  remove?: any;
  move?: any;
  reload?: any;
  duplicate?: any;
  sendMessage?: any;
  getZoom?: any;
  getZoomSettings?: any;
  setZoom?: any;
};

function makeNoopListener() {
  return { addListener: () => {} };
}

/**
 * Builds a chrome stub with controllable `tabs.query` and returns the vi.fn mocks for `tabs.update`
 * (and any extras passed in).
 *
 * `queryMap` allows different query responses keyed by a JSON.stringify of the queryInfo object;
 * when no key matches the stub falls back to `defaultTabs`.
 */
function buildChrome(
  defaultTabs: any[],
  extra: Partial<TabsStub> = {},
): { update: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> } {
  const update = vi.fn();
  const query = vi.fn((_q: any, cb: (t: any[]) => void) => cb(defaultTabs));
  g.chrome.tabs = {
    onRemoved: makeNoopListener(),
    onUpdated: makeNoopListener(),
    onCreated: makeNoopListener(),
    onMoved: makeNoopListener(),
    onActivated: makeNoopListener(),
    onDetached: makeNoopListener(),
    onAttached: makeNoopListener(),
    query,
    update,
    ...extra,
  };
  g.chrome.windows = { onFocusChanged: makeNoopListener() };
  g.chrome.commands = { onCommand: makeNoopListener() };
  return { update, query };
}

/** Creates a tabs unit and hands back the mocks. */
function tabUnitOver(tabs: any[], conf: Record<string, any> = {}, extra: Partial<TabsStub> = {}) {
  const { update, query } = buildChrome(tabs, extra);
  const handlers: Record<string, any> = {};
  const unit = createTabs({
    _response: vi.fn(),
    conf,
    browser: { _setNewTabUrl: () => "about:newtab" },
    handlers,
  });
  // back-fill handlers so cross-calls work
  Object.assign(handlers, unit.handlers);
  return { unit, update, query, handlers };
}

// ---------------------------------------------------------------------------
// createTabs — tab navigation index math
// ---------------------------------------------------------------------------

describe("createTabs — tab navigation index math", () => {
  it("previousTab from the first tab wraps to the last", () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const previousTab = unit.handlers["previousTab"];
    expectDefined(previousTab);
    previousTab({ repeats: 1 }, { tab: { index: 0, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(3, { active: true });
  });

  it("nextTab from the last tab wraps to the first", () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const nextTab = unit.handlers["nextTab"];
    expectDefined(nextTab);
    nextTab({ repeats: 1 }, { tab: { index: 2, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(1, { active: true });
  });

  it("nextTab steps forward without wrapping inside the range", () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const nextTab = unit.handlers["nextTab"];
    expectDefined(nextTab);
    nextTab({ repeats: 1 }, { tab: { index: 0, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(2, { active: true });
  });

  it("previousTab with repeats > 1 steps back multiple positions", () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    const previousTab = unit.handlers["previousTab"];
    expectDefined(previousTab);
    // index 3, step -3 -> index 0 -> id 1
    previousTab({ repeats: 3 }, { tab: { index: 3, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(1, { active: true });
  });
});

// ---------------------------------------------------------------------------
// filterByTitleOrUrl
// ---------------------------------------------------------------------------

describe("createTabs — filterByTitleOrUrl", () => {
  it("strips tabs without a URL before filtering", () => {
    const { unit } = tabUnitOver([]);
    const result = unit.filterByTitleOrUrl(
      [{ title: "No URL tab" }, { url: "https://example.com", title: "Example" }],
      "",
    );
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
  });

  it("returns only tabs matching the query string", () => {
    const { unit } = tabUnitOver([]);
    const tabs = [
      { url: "https://example.com", title: "Example" },
      { url: "https://other.org", title: "Other" },
    ];
    const result = unit.filterByTitleOrUrl(tabs, "example");
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
  });

  it("returns all URL-bearing tabs when query is empty", () => {
    const { unit } = tabUnitOver([]);
    const tabs = [
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: "B" },
    ];
    expect(unit.filterByTitleOrUrl(tabs, "")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// focusTabByIndex
// ---------------------------------------------------------------------------

describe("focusTabByIndex", () => {
  it("activates the tab at repeats-1 index when repeats is in range", () => {
    const tabs = [{ id: 10 }, { id: 20 }, { id: 30 }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["focusTabByIndex"];
    expectDefined(handler);
    handler({ repeats: 2, queryInfo: { currentWindow: true } }, {}, vi.fn());
    expect(update).toHaveBeenCalledWith(20, { active: true });
  });

  it("does not call tabs.update when repeats is 0", () => {
    const tabs = [{ id: 10 }, { id: 20 }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["focusTabByIndex"];
    expectDefined(handler);
    handler({ repeats: 0, queryInfo: { currentWindow: true } }, {}, vi.fn());
    expect(update).not.toHaveBeenCalled();
  });

  it("does not call tabs.update when repeats exceeds tab count", () => {
    const tabs = [{ id: 10 }, { id: 20 }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["focusTabByIndex"];
    expectDefined(handler);
    handler({ repeats: 5, queryInfo: { currentWindow: true } }, {}, vi.fn());
    expect(update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// focusTab
// ---------------------------------------------------------------------------

describe("focusTab handler", () => {
  it("calls windows.update + tabs.update when windowId differs from sender", () => {
    const tabs = [{ id: 99 }];
    const { unit, update } = tabUnitOver(tabs);
    // attach windows.update after unit creation so it is available at call time
    const windowsUpdate = vi.fn((_id: any, _opts: any, cb?: () => void) => cb && cb());
    g.chrome.windows = { ...g.chrome.windows, update: windowsUpdate };
    const handler = unit.handlers["focusTab"];
    expectDefined(handler);
    handler({ windowId: 7, tabId: 99 }, { tab: { windowId: 3 } }, vi.fn());
    expect(windowsUpdate).toHaveBeenCalledWith(7, { focused: true }, expect.any(Function));
    expect(update).toHaveBeenCalledWith(99, { active: true });
  });

  it("calls only tabs.update when windowId matches sender windowId", () => {
    const tabs = [{ id: 99 }];
    const { unit, update } = tabUnitOver(tabs);
    const windowsUpdate = vi.fn();
    g.chrome.windows = { ...g.chrome.windows, update: windowsUpdate };
    const handler = unit.handlers["focusTab"];
    expectDefined(handler);
    handler({ windowId: 3, tabId: 99 }, { tab: { windowId: 3 } }, vi.fn());
    expect(windowsUpdate).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(99, { active: true });
  });
});

// ---------------------------------------------------------------------------
// togglePinTab
// ---------------------------------------------------------------------------

describe("togglePinTab", () => {
  it("toggles the pinned state of the active tab from unpinned to pinned", () => {
    const tabs = [{ id: 42, pinned: false }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["togglePinTab"];
    expectDefined(handler);
    handler({}, {}, vi.fn());
    expect(update).toHaveBeenCalledWith(42, { pinned: true });
  });

  it("toggles the pinned state from pinned to unpinned", () => {
    const tabs = [{ id: 42, pinned: true, active: true }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["togglePinTab"];
    expectDefined(handler);
    handler({}, {}, vi.fn());
    expect(update).toHaveBeenCalledWith(42, { pinned: false });
  });
});

// ---------------------------------------------------------------------------
// muteTab
// ---------------------------------------------------------------------------

describe("muteTab", () => {
  it("mutes an unmuted tab", () => {
    const tabs = [{ id: 5 }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["muteTab"];
    expectDefined(handler);
    handler({}, { tab: { id: 5, mutedInfo: { muted: false } } }, vi.fn());
    expect(update).toHaveBeenCalledWith(5, { muted: true });
  });

  it("unmutes a muted tab", () => {
    const tabs = [{ id: 5 }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["muteTab"];
    expectDefined(handler);
    handler({}, { tab: { id: 5, mutedInfo: { muted: true } } }, vi.fn());
    expect(update).toHaveBeenCalledWith(5, { muted: false });
  });
});

// ---------------------------------------------------------------------------
// closeTabByIds
// ---------------------------------------------------------------------------

describe("closeTabByIds", () => {
  it("calls tabs.remove with the provided tab IDs", () => {
    const remove = vi.fn();
    const { unit } = tabUnitOver([], {}, { remove });
    const handler = unit.handlers["closeTabByIds"];
    expectDefined(handler);
    handler({ tabIds: [1, 2, 3] }, {}, vi.fn());
    expect(remove).toHaveBeenCalledWith([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// tabOnly
// ---------------------------------------------------------------------------

describe("tabOnly", () => {
  it("removes all non-pinned tabs except the sender tab", () => {
    const remove = vi.fn();
    const tabs = [
      { id: 1, pinned: false },
      { id: 2, pinned: true },
      { id: 3, pinned: false },
      { id: 4, pinned: false },
    ];
    const { unit } = tabUnitOver(tabs, {}, { remove });
    const handler = unit.handlers["tabOnly"];
    expectDefined(handler);
    // sender tab id = 3 (stays), id=2 is pinned (stays), id=1 and id=4 removed
    handler({}, { tab: { id: 3 } }, vi.fn());
    expect(remove).toHaveBeenCalledWith([1, 4]);
  });
});

// ---------------------------------------------------------------------------
// getTabURLs / tabURLAccessed / getTopURL
// ---------------------------------------------------------------------------

describe("tabURLAccessed and getTabURLs", () => {
  it("records URL accesses and returns them via getTabURLs", () => {
    const { unit } = tabUnitOver([]);
    const accessed = unit.handlers["tabURLAccessed"];
    const getUrls = unit.handlers["getTabURLs"];
    expectDefined(accessed);
    expectDefined(getUrls);

    const sender = { tab: { id: 7, active: true, index: 2 } };
    accessed({ url: "https://example.com", title: "Example" }, sender, vi.fn());
    accessed({ url: "https://other.com", title: "Other" }, sender, vi.fn());

    const result = getUrls({}, sender, vi.fn());
    expectDefined(result);
    const urls = (result as any).urls as Array<{ url: string; title: string }>;
    expect(urls).toHaveLength(2);
    expect(urls.map((u) => u.url)).toContain("https://example.com");
    expect(urls.map((u) => u.url)).toContain("https://other.com");
  });

  it("returns the active flag and 0 index when showTabIndices is not set", () => {
    const { unit } = tabUnitOver([]);
    const accessed = unit.handlers["tabURLAccessed"];
    expectDefined(accessed);
    const sender = { tab: { id: 9, active: true, index: 3 } };
    const result = accessed({ url: "https://a.com", title: "A" }, sender, vi.fn());
    expect(result).toEqual({ active: true, index: 0 });
  });

  it("returns index + 1 when showTabIndices is enabled", () => {
    const { unit } = tabUnitOver([], { showTabIndices: true });
    const accessed = unit.handlers["tabURLAccessed"];
    expectDefined(accessed);
    const sender = { tab: { id: 9, active: false, index: 2 } };
    const result = accessed({ url: "https://b.com", title: "B" }, sender, vi.fn());
    expect(result).toEqual({ active: false, index: 3 });
  });

  it("returns an empty object when sender has no tab", () => {
    const { unit } = tabUnitOver([]);
    const accessed = unit.handlers["tabURLAccessed"];
    expectDefined(accessed);
    const result = accessed({ url: "https://c.com", title: "C" }, {}, vi.fn());
    expect(result).toEqual({});
  });

  it("returns empty urls list for an unknown tab", () => {
    const { unit } = tabUnitOver([]);
    const getUrls = unit.handlers["getTabURLs"];
    expectDefined(getUrls);
    const result = getUrls({}, { tab: { id: 999 } }, vi.fn());
    expect(result).toEqual({ urls: [] });
  });
});

describe("getTopURL", () => {
  it("returns the sender tab URL", () => {
    const { unit } = tabUnitOver([]);
    const handler = unit.handlers["getTopURL"];
    expectDefined(handler);
    const result = handler({}, { tab: { url: "https://top.com" } }, vi.fn());
    expect(result).toEqual({ url: "https://top.com" });
  });

  it("returns empty string when sender has no tab", () => {
    const { unit } = tabUnitOver([]);
    const handler = unit.handlers["getTopURL"];
    expectDefined(handler);
    const result = handler({}, {}, vi.fn());
    expect(result).toEqual({ url: "" });
  });
});

// ---------------------------------------------------------------------------
// queueURLs / getQueueURLs / clearQueueURLs
// ---------------------------------------------------------------------------

describe("URL queue management", () => {
  it("accumulates URLs across multiple queueURLs calls", () => {
    const { unit } = tabUnitOver([]);
    const queue = unit.handlers["queueURLs"];
    const get = unit.handlers["getQueueURLs"];
    expectDefined(queue);
    expectDefined(get);

    queue({ urls: ["https://a.com"] }, {}, vi.fn());
    queue({ urls: ["https://b.com", "https://c.com"] }, {}, vi.fn());

    const result = get({}, {}, vi.fn());
    expect(result).toEqual({ queueURLs: ["https://a.com", "https://b.com", "https://c.com"] });
  });

  it("clearQueueURLs empties the queue", () => {
    const { unit } = tabUnitOver([]);
    const queue = unit.handlers["queueURLs"];
    const clear = unit.handlers["clearQueueURLs"];
    const get = unit.handlers["getQueueURLs"];
    expectDefined(queue);
    expectDefined(clear);
    expectDefined(get);

    queue({ urls: ["https://a.com"] }, {}, vi.fn());
    clear({}, {}, vi.fn());
    const result = get({}, {}, vi.fn());
    expect(result).toEqual({ queueURLs: [] });
  });
});

// ---------------------------------------------------------------------------
// duplicateTab
// ---------------------------------------------------------------------------

describe("duplicateTab", () => {
  it("calls tabs.duplicate with the sender tab id", () => {
    const duplicate = vi.fn((_id: number, cb?: () => void) => cb && cb());
    const { unit } = tabUnitOver([], {}, { duplicate });
    const handler = unit.handlers["duplicateTab"];
    expectDefined(handler);
    handler({ active: true }, { tab: { id: 17 } }, vi.fn());
    expect(duplicate).toHaveBeenCalledWith(17, expect.any(Function));
  });

  it("re-activates the original tab when active is false", () => {
    const duplicate = vi.fn((_id: number, cb?: () => void) => cb && cb());
    const { unit, update } = tabUnitOver([], {}, { duplicate });
    const handler = unit.handlers["duplicateTab"];
    expectDefined(handler);
    handler({ active: false }, { tab: { id: 17 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(17, { active: true });
  });
});

// ---------------------------------------------------------------------------
// moveTab
// ---------------------------------------------------------------------------

describe("moveTab", () => {
  it("moves the tab forward by step * repeats positions", () => {
    const move = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const { unit } = tabUnitOver(tabs, {}, { move });
    const handler = unit.handlers["moveTab"];
    expectDefined(handler);
    // tab at index 1, step 1, repeats 2 -> destination 3, clamped to tabs.length = 5
    handler({ step: 1, repeats: 2 }, { tab: { id: 2, index: 1, windowId: 1 } }, vi.fn());
    expect(move).toHaveBeenCalledWith(2, { index: 3 });
  });

  it("clamps the move target to the end of the list", () => {
    const move = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { unit } = tabUnitOver(tabs, {}, { move });
    const handler = unit.handlers["moveTab"];
    expectDefined(handler);
    // tab at index 2, step 1, repeats 5 -> raw 7 clamped to length (3)
    handler({ step: 1, repeats: 5 }, { tab: { id: 3, index: 2, windowId: 1 } }, vi.fn());
    expect(move).toHaveBeenCalledWith(3, { index: 3 });
  });
});

// ---------------------------------------------------------------------------
// getWindows
// ---------------------------------------------------------------------------

describe("getWindows", () => {
  it("groups tabs by windowId and marks the previous choice", () => {
    const _response = vi.fn();
    const noopListener = makeNoopListener();
    const tabs = [
      { id: 1, windowId: 10, title: "T1", url: "https://a.com" },
      { id: 2, windowId: 10, title: "T2", url: "https://b.com" },
      { id: 3, windowId: 20, title: "T3", url: "https://c.com" },
    ];
    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query: (_q: any, cb: (t: any[]) => void) => cb(tabs),
      update: vi.fn(),
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };

    const unit = createTabs({
      _response,
      conf: {},
      browser: { _setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });

    const handler = unit.handlers["getWindows"];
    expectDefined(handler);
    const sendResponse = vi.fn();
    handler({}, {}, sendResponse);

    expect(_response).toHaveBeenCalled();
    const args = _response.mock.calls[0]!;
    const result = args[2] as {
      windows: Array<{ id: string; tabs: any[]; isPreviousChoice: boolean }>;
    };
    expect(result.windows).toHaveLength(2);

    const win10 = result.windows.find((w) => w.id === "10");
    expectDefined(win10);
    expect(win10.tabs).toHaveLength(2);

    const win20 = result.windows.find((w) => w.id === "20");
    expectDefined(win20);
    expect(win20.tabs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// moveToWindow
// ---------------------------------------------------------------------------

describe("moveToWindow", () => {
  it("creates a new window when windowId is -1", () => {
    const { unit } = tabUnitOver([]);
    const windowsCreate = vi.fn();
    g.chrome.windows = { ...g.chrome.windows, create: windowsCreate };
    const handler = unit.handlers["moveToWindow"];
    expectDefined(handler);
    handler({ windowId: -1 }, { tab: { id: 5, windowId: 1 } }, vi.fn());
    expect(windowsCreate).toHaveBeenCalledWith({ tabId: 5 });
  });

  it("moves the tab to an existing window and focuses it", () => {
    const move = vi.fn((_id: any, _opts: any, cb?: () => void) => cb && cb());
    const { unit, update } = tabUnitOver([], {}, { move });
    const windowsUpdate = vi.fn((_id: any, _opts: any, cb?: () => void) => cb && cb());
    g.chrome.windows = { ...g.chrome.windows, update: windowsUpdate };
    const handler = unit.handlers["moveToWindow"];
    expectDefined(handler);
    handler({ windowId: 8 }, { tab: { id: 5, windowId: 1 } }, vi.fn());
    expect(move).toHaveBeenCalledWith(5, { windowId: 8, index: -1 }, expect.any(Function));
    expect(windowsUpdate).toHaveBeenCalledWith(8, { focused: true }, expect.any(Function));
    expect(update).toHaveBeenCalledWith(5, { active: true });
  });
});

// ---------------------------------------------------------------------------
// gatherWindows
// ---------------------------------------------------------------------------

describe("gatherWindows", () => {
  it("moves all non-current-window tabs into the sender window", () => {
    const move = vi.fn();
    const otherTabs = [
      { id: 10, windowId: 20 },
      { id: 11, windowId: 30 },
    ];
    const { unit } = tabUnitOver(otherTabs, {}, { move });
    const handler = unit.handlers["gatherWindows"];
    expectDefined(handler);
    handler({}, { tab: { windowId: 1 } }, vi.fn());
    expect(move).toHaveBeenCalledWith(10, { windowId: 1, index: -1 });
    expect(move).toHaveBeenCalledWith(11, { windowId: 1, index: -1 });
  });
});

// ---------------------------------------------------------------------------
// gatherTabs
// ---------------------------------------------------------------------------

describe("gatherTabs", () => {
  it("moves the provided tabs into the sender window", () => {
    const move = vi.fn();
    const { unit } = tabUnitOver([], {}, { move });
    const handler = unit.handlers["gatherTabs"];
    expectDefined(handler);
    const tabsToGather = [{ id: 50 }, { id: 51 }];
    handler({ tabs: tabsToGather }, { tab: { windowId: 2 } }, vi.fn());
    expect(move).toHaveBeenCalledWith(50, { windowId: 2, index: -1 });
    expect(move).toHaveBeenCalledWith(51, { windowId: 2, index: -1 });
  });
});

// ---------------------------------------------------------------------------
// getTabs (MRU ordering)
// ---------------------------------------------------------------------------

describe("getTabs", () => {
  it("returns all tabs filtered by title/url", () => {
    const _response = vi.fn();
    const tabs = [
      { id: 1, url: "https://example.com", title: "Example" },
      { id: 2, url: "https://other.org", title: "Other" },
    ];
    const noopListener = makeNoopListener();
    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query: (_q: any, cb: (t: any[]) => void) => cb(tabs),
      update: vi.fn(),
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      _response,
      conf: {},
      browser: { _setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });

    const handler = unit.handlers["getTabs"];
    expectDefined(handler);
    handler({ filter: "example", tabsThreshold: 100, queryInfo: {} }, { tab: { id: 99 } }, vi.fn());
    expect(_response).toHaveBeenCalled();
    const result = _response.mock.calls[0]![2] as { tabs: any[] };
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe(1);
  });

  it("sorts by lastAccessed when tabsMRUOrder is enabled and count exceeds threshold", () => {
    const _response = vi.fn();
    const tabs = [
      { id: 1, url: "https://a.com", title: "A", lastAccessed: 100 },
      { id: 2, url: "https://b.com", title: "B", lastAccessed: 300 },
      { id: 3, url: "https://c.com", title: "C", lastAccessed: 200 },
      { id: 99, url: "https://current.com", title: "Current" }, // sender tab, should be excluded
    ];
    const noopListener = makeNoopListener();
    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query: (_q: any, cb: (t: any[]) => void) => cb(tabs),
      update: vi.fn(),
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      _response,
      conf: { tabsMRUOrder: true },
      browser: { _setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });

    const handler = unit.handlers["getTabs"];
    expectDefined(handler);
    // threshold=2: 3 non-sender tabs > 2 so MRU sort kicks in
    handler({ filter: "", tabsThreshold: 2, queryInfo: {} }, { tab: { id: 99 } }, vi.fn());
    expect(_response).toHaveBeenCalled();
    const result = _response.mock.calls[0]![2] as { tabs: any[] };
    // sender tab excluded; sorted descending by lastAccessed: 300, 200, 100
    expect(result.tabs.map((t) => t.id)).toEqual([2, 3, 1]);
  });
});

// ---------------------------------------------------------------------------
// goToLastTab
// ---------------------------------------------------------------------------

describe("goToLastTab", () => {
  it("activates the previously visited tab from tabHistory", () => {
    const noopListener = makeNoopListener();
    const update = vi.fn();
    // sendMessage must be present so _tabActivated does not throw when onActivated fires
    const sendMessage = vi.fn().mockReturnValue(undefined);
    let onActivatedCb: ((info: any) => void) | null = null;

    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: {
        addListener: (cb: (info: any) => void) => {
          onActivatedCb = cb;
        },
      },
      onDetached: noopListener,
      onAttached: noopListener,
      query: (_q: any, cb: (t: any[]) => void) => cb([]),
      update,
      sendMessage,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };

    const unit = createTabs({
      _response: vi.fn(),
      conf: {},
      browser: { _setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });

    // simulate activating tabs 5 then 6 to populate history
    // onActivatedCb is assigned inside the addListener closure above; assert non-null
    onActivatedCb!({ tabId: 5 });
    onActivatedCb!({ tabId: 6 });

    const handler = unit.handlers["goToLastTab"];
    expectDefined(handler);
    handler({}, {}, vi.fn());
    // should go back to tab 5
    expect(update).toHaveBeenCalledWith(5, { active: true });
  });
});

// ---------------------------------------------------------------------------
// openLink — normalizeURL branches
// ---------------------------------------------------------------------------

describe("openLink — URL normalization and tabbed behavior", () => {
  it("blocks JavaScript URLs and sends a banner message", () => {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const { unit } = tabUnitOver([], {}, { sendMessage });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    handler(
      { url: "javascript:alert(1)", tab: { tabbed: false } },
      { tab: { id: 3, pinned: false }, frameId: 0 },
      vi.fn(),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ subject: "showBanner" }),
      { frameId: 0 },
    );
  });

  it("adds http:// prefix to a bare hostname", () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], {}, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    handler(
      {
        url: "example.com",
        tab: { tabbed: true, active: true, pinned: false },
      },
      { tab: { id: 1, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://example.com" }),
      expect.any(Function),
    );
  });

  it("leaves view-source: URLs as-is", () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], {}, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    handler(
      {
        url: "view-source:https://example.com",
        tab: { tabbed: true, active: true, pinned: false },
      },
      { tab: { id: 1, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ url: "view-source:https://example.com" }),
      expect.any(Function),
    );
  });

  it("opens in the current tab (not tabbed) when tab.tabbed is false", () => {
    const update = vi.fn();
    g.chrome.tabs = {
      ...(g.chrome.tabs as any),
      update,
    };
    const { unit } = tabUnitOver([], {}, { update });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    handler(
      {
        url: "https://example.com",
        tab: { tabbed: false, pinned: false },
      },
      { tab: { id: 2, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com" }),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// openUrlInNewTab — newTabPosition config branches
// ---------------------------------------------------------------------------

describe("openUrlInNewTab — newTabPosition config", () => {
  function makeOpenLinkSender(tabIndex: number) {
    return {
      tab: { id: 1, index: tabIndex, pinned: false },
      frameId: 0,
      url: "https://other.com",
    };
  }

  it("places the new tab at currentTab.index when newTabPosition is 'left'", () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], { newTabPosition: "left" }, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    handler(
      { url: "https://example.com", tab: { tabbed: true, active: true, pinned: false } },
      makeOpenLinkSender(3),
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ index: 3 }),
      expect.any(Function),
    );
  });

  it("places the new tab at currentTab.index+1 when newTabPosition is 'right'", () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], { newTabPosition: "right" }, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    handler(
      { url: "https://example.com", tab: { tabbed: true, active: true, pinned: false } },
      makeOpenLinkSender(3),
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ index: 4 }),
      expect.any(Function),
    );
  });

  it("places the new tab at index 0 when newTabPosition is 'first'", () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], { newTabPosition: "first" }, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    handler(
      { url: "https://example.com", tab: { tabbed: true, active: true, pinned: false } },
      makeOpenLinkSender(3),
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0 }),
      expect.any(Function),
    );
  });

  it("does not pass an index when newTabPosition is 'last'", () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], { newTabPosition: "last" }, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    handler(
      { url: "https://example.com", tab: { tabbed: true, active: true, pinned: false } },
      makeOpenLinkSender(3),
      vi.fn(),
    );
    const callArgs = create.mock.calls[0]![0];
    expect(callArgs.index).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// viewSource
// ---------------------------------------------------------------------------

describe("viewSource", () => {
  it("prepends view-source: to the sender tab URL and delegates to openLink", () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], {}, { create });
    const handler = unit.handlers["viewSource"];
    expectDefined(handler);
    handler(
      { tab: { tabbed: true, active: true, pinned: false } },
      {
        tab: { id: 1, url: "https://example.com", pinned: false },
        frameId: 0,
        url: "https://other.com",
      },
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ url: "view-source:https://example.com" }),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// reloadTab
// ---------------------------------------------------------------------------

describe("reloadTab", () => {
  it("reloads the specified number of tabs starting from the current", () => {
    const reload = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const { unit } = tabUnitOver(tabs, {}, { reload });
    const handler = unit.handlers["reloadTab"];
    expectDefined(handler);
    handler({ repeats: 2, nocache: false }, { tab: { id: 2, index: 1, windowId: 1 } }, vi.fn());
    expect(reload).toHaveBeenCalledWith(2, { bypassCache: false });
    expect(reload).toHaveBeenCalledWith(3, { bypassCache: false });
  });

  it("passes bypassCache: true when nocache is set", () => {
    const reload = vi.fn();
    const tabs = [{ id: 10 }, { id: 20 }];
    const { unit } = tabUnitOver(tabs, {}, { reload });
    const handler = unit.handlers["reloadTab"];
    expectDefined(handler);
    handler({ repeats: 1, nocache: true }, { tab: { id: 10, index: 0, windowId: 1 } }, vi.fn());
    expect(reload).toHaveBeenCalledWith(10, { bypassCache: true });
  });
});

// ---------------------------------------------------------------------------
// closeTabsToRight / closeTabsToLeft
// ---------------------------------------------------------------------------

describe("closeTabsToRight", () => {
  it("removes all tabs to the right of the sender tab", () => {
    const remove = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const { unit } = tabUnitOver(tabs, {}, { remove });
    const handler = unit.handlers["closeTabsToRight"];
    expectDefined(handler);
    // sender is at index 1 (id=2); tabs to the right: id=3, id=4
    handler({}, { tab: { id: 2, index: 1 } }, vi.fn());
    expect(remove).toHaveBeenCalledWith([3, 4]);
  });
});

describe("closeTabsToLeft", () => {
  it("removes all tabs to the left of the sender tab", () => {
    const remove = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const { unit } = tabUnitOver(tabs, {}, { remove });
    const handler = unit.handlers["closeTabsToLeft"];
    expectDefined(handler);
    // sender is at index 2 (id=3); tabs to the left: id=1, id=2
    handler({}, { tab: { id: 3, index: 2 } }, vi.fn());
    expect(remove).toHaveBeenCalledWith([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// closeTab with focusAfterClosed
// ---------------------------------------------------------------------------

describe("closeTab — focusAfterClosed", () => {
  it("navigates left after closing when focusAfterClosed is 'left'", () => {
    const remove = vi.fn((_ids: any, cb?: () => void) => cb && cb());
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { unit, update } = tabUnitOver(tabs, { focusAfterClosed: "left" }, { remove });
    const handler = unit.handlers["closeTab"];
    expectDefined(handler);
    handler({ repeats: 1 }, { tab: { id: 2, index: 1, windowId: 1 } }, vi.fn());
    expect(remove).toHaveBeenCalled();
    // after close, should navigate to previous tab (index - 1 = 0 -> id=1)
    expect(update).toHaveBeenCalledWith(1, { active: true });
  });
});

// ---------------------------------------------------------------------------
// newTabUrl is propagated
// ---------------------------------------------------------------------------

describe("newTabUrl", () => {
  it("is set to the value returned by browser._setNewTabUrl()", () => {
    const { unit } = tabUnitOver([]);
    expect(unit.newTabUrl).toBe("about:newtab");
  });
});
