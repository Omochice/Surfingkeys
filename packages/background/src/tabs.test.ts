import { expectDefined } from "@sk/test-support/helpers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTabs, fixTo, roundBase } from "./tabs";

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

describe("fixTo", () => {
  it("clamps a negative target up to 0", () => {
    expect(fixTo(-3, 10)).toBe(0);
  });

  it("leaves an in-range target untouched", () => {
    expect(fixTo(4, 10)).toBe(4);
  });

  it("clamps an over-range target down to length", () => {
    expect(fixTo(10, 10)).toBe(10);
    expect(fixTo(15, 10)).toBe(10);
  });
});

describe("roundBase", () => {
  it("leaves the base when the repeat count fits ahead", () => {
    expect(roundBase(2, 3, 10)).toBe(2);
  });

  it("rounds the base back when the repeat count would overrun the length", () => {
    expect(roundBase(8, 5, 10)).toBe(5);
    expect(roundBase(9, 3, 10)).toBe(7);
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
 * Builds a chrome stub with a promise-based `tabs.query` and returns the vi.fn mocks for
 * `tabs.update` (and any extras passed in). The query resolves `defaultTabs`.
 */
function buildChrome(
  defaultTabs: any[],
  extra: Partial<TabsStub> = {},
): { update: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> } {
  const update = vi.fn();
  const query = vi.fn().mockResolvedValue(defaultTabs);
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
    conf,
    browser: { setNewTabUrl: () => "about:newtab" },
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
  it("previousTab from the first tab wraps to the last", async () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const previousTab = unit.handlers["previousTab"];
    expectDefined(previousTab);
    await previousTab({ repeats: 1 }, { tab: { index: 0, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(3, { active: true });
  });

  it("nextTab from the last tab wraps to the first", async () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const nextTab = unit.handlers["nextTab"];
    expectDefined(nextTab);
    await nextTab({ repeats: 1 }, { tab: { index: 2, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(1, { active: true });
  });

  it("nextTab steps forward without wrapping inside the range", async () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const nextTab = unit.handlers["nextTab"];
    expectDefined(nextTab);
    await nextTab({ repeats: 1 }, { tab: { index: 0, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(2, { active: true });
  });

  it("previousTab with repeats > 1 steps back multiple positions", async () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    const previousTab = unit.handlers["previousTab"];
    expectDefined(previousTab);
    // index 3, step -3 -> index 0 -> id 1
    await previousTab({ repeats: 3 }, { tab: { index: 3, windowId: 5 } }, vi.fn());
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
    expect(result[0]?.url).toBe("https://example.com");
  });

  it("returns only tabs matching the query string", () => {
    const { unit } = tabUnitOver([]);
    const tabs = [
      { url: "https://example.com", title: "Example" },
      { url: "https://other.org", title: "Other" },
    ];
    const result = unit.filterByTitleOrUrl(tabs, "example");
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://example.com");
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
// getTabs — MRU ordering
// ---------------------------------------------------------------------------

describe("createTabs — getTabs", () => {
  it("orders tabs by recent access and leaves the queried array unmodified", async () => {
    const tabs = [
      { id: 1, url: "https://a.com", title: "A", lastAccessed: 100 },
      { id: 2, url: "https://b.com", title: "B", lastAccessed: 300 },
      { id: 3, url: "https://c.com", title: "C", lastAccessed: 200 },
    ];
    const { handlers } = tabUnitOver(tabs, { tabsMRUOrder: true });
    const getTabs = handlers["getTabs"];
    expectDefined(getTabs);

    const result = await getTabs(
      { filter: "", tabsThreshold: 1, queryInfo: {} },
      { tab: { id: 99 } },
      vi.fn(),
    );

    expect(result.tabs.map((t: any) => t.id)).toEqual([2, 3, 1]);
    expect(tabs.map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// focusTabByIndex
// ---------------------------------------------------------------------------

describe("focusTabByIndex", () => {
  it("activates the tab at repeats-1 index when repeats is in range", async () => {
    const tabs = [{ id: 10 }, { id: 20 }, { id: 30 }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["focusTabByIndex"];
    expectDefined(handler);
    await handler({ repeats: 2, queryInfo: { currentWindow: true } }, {}, vi.fn());
    expect(update).toHaveBeenCalledWith(20, { active: true });
  });

  it("does not call tabs.update when repeats is 0", async () => {
    const tabs = [{ id: 10 }, { id: 20 }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["focusTabByIndex"];
    expectDefined(handler);
    await handler({ repeats: 0, queryInfo: { currentWindow: true } }, {}, vi.fn());
    expect(update).not.toHaveBeenCalled();
  });

  it("does not call tabs.update when repeats exceeds tab count", async () => {
    const tabs = [{ id: 10 }, { id: 20 }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["focusTabByIndex"];
    expectDefined(handler);
    await handler({ repeats: 5, queryInfo: { currentWindow: true } }, {}, vi.fn());
    expect(update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// focusTab
// ---------------------------------------------------------------------------

describe("focusTab handler", () => {
  it("calls windows.update + tabs.update when windowId differs from sender", async () => {
    const tabs = [{ id: 99 }];
    const { unit, update } = tabUnitOver(tabs);
    // attach windows.update after unit creation so it is available at call time
    const windowsUpdate = vi.fn().mockResolvedValue(undefined);
    g.chrome.windows = { ...g.chrome.windows, update: windowsUpdate };
    const handler = unit.handlers["focusTab"];
    expectDefined(handler);
    await handler({ windowId: 7, tabId: 99 }, { tab: { windowId: 3 } }, vi.fn());
    expect(windowsUpdate).toHaveBeenCalledWith(7, { focused: true });
    expect(update).toHaveBeenCalledWith(99, { active: true });
  });

  it("calls only tabs.update when windowId matches sender windowId", async () => {
    const tabs = [{ id: 99 }];
    const { unit, update } = tabUnitOver(tabs);
    const windowsUpdate = vi.fn();
    g.chrome.windows = { ...g.chrome.windows, update: windowsUpdate };
    const handler = unit.handlers["focusTab"];
    expectDefined(handler);
    await handler({ windowId: 3, tabId: 99 }, { tab: { windowId: 3 } }, vi.fn());
    expect(windowsUpdate).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(99, { active: true });
  });
});

// ---------------------------------------------------------------------------
// togglePinTab
// ---------------------------------------------------------------------------

describe("togglePinTab", () => {
  it("toggles the pinned state of the active tab from unpinned to pinned", async () => {
    const tabs = [{ id: 42, pinned: false }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["togglePinTab"];
    expectDefined(handler);
    await handler({}, {}, vi.fn());
    expect(update).toHaveBeenCalledWith(42, { pinned: true });
  });

  it("toggles the pinned state from pinned to unpinned", async () => {
    const tabs = [{ id: 42, pinned: true, active: true }];
    const { unit, update } = tabUnitOver(tabs);
    const handler = unit.handlers["togglePinTab"];
    expectDefined(handler);
    await handler({}, {}, vi.fn());
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
  it("removes all non-pinned tabs except the sender tab", async () => {
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
    await handler({}, { tab: { id: 3 } }, vi.fn());
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
  it("calls tabs.duplicate with the sender tab id", async () => {
    const duplicate = vi.fn().mockResolvedValue(undefined);
    const { unit } = tabUnitOver([], {}, { duplicate });
    const handler = unit.handlers["duplicateTab"];
    expectDefined(handler);
    await handler({ active: true }, { tab: { id: 17 } }, vi.fn());
    expect(duplicate).toHaveBeenCalledWith(17);
  });

  it("re-activates the original tab when active is false", async () => {
    const duplicate = vi.fn().mockResolvedValue(undefined);
    const { unit, update } = tabUnitOver([], {}, { duplicate });
    const handler = unit.handlers["duplicateTab"];
    expectDefined(handler);
    await handler({ active: false }, { tab: { id: 17 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(17, { active: true });
  });
});

// ---------------------------------------------------------------------------
// moveTab
// ---------------------------------------------------------------------------

describe("moveTab", () => {
  it("moves the tab forward by step * repeats positions", async () => {
    const move = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const { unit } = tabUnitOver(tabs, {}, { move });
    const handler = unit.handlers["moveTab"];
    expectDefined(handler);
    // tab at index 1, step 1, repeats 2 -> destination 3, clamped to tabs.length = 5
    await handler({ step: 1, repeats: 2 }, { tab: { id: 2, index: 1, windowId: 1 } }, vi.fn());
    expect(move).toHaveBeenCalledWith(2, { index: 3 });
  });

  it("clamps the move target to the end of the list", async () => {
    const move = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { unit } = tabUnitOver(tabs, {}, { move });
    const handler = unit.handlers["moveTab"];
    expectDefined(handler);
    // tab at index 2, step 1, repeats 5 -> raw 7 clamped to length (3)
    await handler({ step: 1, repeats: 5 }, { tab: { id: 3, index: 2, windowId: 1 } }, vi.fn());
    expect(move).toHaveBeenCalledWith(3, { index: 3 });
  });
});

// ---------------------------------------------------------------------------
// getWindows
// ---------------------------------------------------------------------------

describe("getWindows", () => {
  it("groups tabs by windowId and marks the previous choice", async () => {
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
      query: vi.fn().mockResolvedValue(tabs),
      update: vi.fn(),
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };

    const unit = createTabs({
      conf: {},
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });

    const handler = unit.handlers["getWindows"];
    expectDefined(handler);
    const result = (await handler({}, {}, vi.fn())) as {
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
  it("creates a new window when windowId is -1", async () => {
    const { unit } = tabUnitOver([]);
    const windowsCreate = vi.fn();
    g.chrome.windows = { ...g.chrome.windows, create: windowsCreate };
    const handler = unit.handlers["moveToWindow"];
    expectDefined(handler);
    await handler({ windowId: -1 }, { tab: { id: 5, windowId: 1 } }, vi.fn());
    expect(windowsCreate).toHaveBeenCalledWith({ tabId: 5 });
  });

  it("moves the tab to an existing window and focuses it", async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    const { unit, update } = tabUnitOver([], {}, { move });
    const windowsUpdate = vi.fn().mockResolvedValue(undefined);
    g.chrome.windows = { ...g.chrome.windows, update: windowsUpdate };
    const handler = unit.handlers["moveToWindow"];
    expectDefined(handler);
    await handler({ windowId: 8 }, { tab: { id: 5, windowId: 1 } }, vi.fn());
    expect(move).toHaveBeenCalledWith(5, { windowId: 8, index: -1 });
    expect(windowsUpdate).toHaveBeenCalledWith(8, { focused: true });
    expect(update).toHaveBeenCalledWith(5, { active: true });
  });
});

// ---------------------------------------------------------------------------
// gatherWindows
// ---------------------------------------------------------------------------

describe("gatherWindows", () => {
  it("moves all non-current-window tabs into the sender window", async () => {
    const move = vi.fn();
    const otherTabs = [
      { id: 10, windowId: 20 },
      { id: 11, windowId: 30 },
    ];
    const { unit } = tabUnitOver(otherTabs, {}, { move });
    const handler = unit.handlers["gatherWindows"];
    expectDefined(handler);
    await handler({}, { tab: { windowId: 1 } }, vi.fn());
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
  it("returns all tabs filtered by title/url", async () => {
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
      query: vi.fn().mockResolvedValue(tabs),
      update: vi.fn(),
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      conf: {},
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });

    const handler = unit.handlers["getTabs"];
    expectDefined(handler);
    const result = (await handler(
      { filter: "example", tabsThreshold: 100, queryInfo: {} },
      { tab: { id: 99 } },
      vi.fn(),
    )) as { tabs: any[] };
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe(1);
  });

  it("sorts by lastAccessed when tabsMRUOrder is enabled and count exceeds threshold", async () => {
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
      query: vi.fn().mockResolvedValue(tabs),
      update: vi.fn(),
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      conf: { tabsMRUOrder: true },
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });

    const handler = unit.handlers["getTabs"];
    expectDefined(handler);
    // threshold=2: 3 non-sender tabs > 2 so MRU sort kicks in
    const result = (await handler(
      { filter: "", tabsThreshold: 2, queryInfo: {} },
      { tab: { id: 99 } },
      vi.fn(),
    )) as { tabs: any[] };
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
    // sendMessage must be present so tabActivated does not throw when onActivated fires
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
      query: vi.fn().mockResolvedValue([]),
      update,
      sendMessage,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };

    const unit = createTabs({
      conf: {},
      browser: { setNewTabUrl: () => "about:newtab" },
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
  it("blocks JavaScript URLs and sends a banner message", async () => {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const { unit } = tabUnitOver([], {}, { sendMessage });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
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

  it("adds http:// prefix to a bare hostname", async () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], {}, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      {
        url: "example.com",
        tab: { tabbed: true, active: true, pinned: false },
      },
      { tab: { id: 1, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: "http://example.com" }));
  });

  it("leaves view-source: URLs as-is", async () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], {}, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      {
        url: "view-source:https://example.com",
        tab: { tabbed: true, active: true, pinned: false },
      },
      { tab: { id: 1, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ url: "view-source:https://example.com" }),
    );
  });

  it("opens in the current tab (not tabbed) when tab.tabbed is false", async () => {
    const update = vi.fn();
    g.chrome.tabs = {
      ...(g.chrome.tabs as any),
      update,
    };
    const { unit } = tabUnitOver([], {}, { update });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      {
        url: "https://example.com",
        tab: { tabbed: false, pinned: false },
      },
      { tab: { id: 2, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com" }));
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

  it("places the new tab at currentTab.index when newTabPosition is 'left'", async () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], { newTabPosition: "left" }, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      { url: "https://example.com", tab: { tabbed: true, active: true, pinned: false } },
      makeOpenLinkSender(3),
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ index: 3 }));
  });

  it("places the new tab at currentTab.index+1 when newTabPosition is 'right'", async () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], { newTabPosition: "right" }, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      { url: "https://example.com", tab: { tabbed: true, active: true, pinned: false } },
      makeOpenLinkSender(3),
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ index: 4 }));
  });

  it("places the new tab at index 0 when newTabPosition is 'first'", async () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], { newTabPosition: "first" }, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      { url: "https://example.com", tab: { tabbed: true, active: true, pinned: false } },
      makeOpenLinkSender(3),
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ index: 0 }));
  });

  it("does not pass an index when newTabPosition is 'last'", async () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], { newTabPosition: "last" }, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
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
  it("prepends view-source: to the sender tab URL and delegates to openLink", async () => {
    const create = vi.fn();
    const { unit } = tabUnitOver([], {}, { create });
    const handler = unit.handlers["viewSource"];
    expectDefined(handler);
    await handler(
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
    );
  });
});

// ---------------------------------------------------------------------------
// reloadTab
// ---------------------------------------------------------------------------

describe("reloadTab", () => {
  it("reloads the specified number of tabs starting from the current", async () => {
    const reload = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const { unit } = tabUnitOver(tabs, {}, { reload });
    const handler = unit.handlers["reloadTab"];
    expectDefined(handler);
    await handler(
      { repeats: 2, nocache: false },
      { tab: { id: 2, index: 1, windowId: 1 } },
      vi.fn(),
    );
    expect(reload).toHaveBeenCalledWith(2, { bypassCache: false });
    expect(reload).toHaveBeenCalledWith(3, { bypassCache: false });
  });

  it("passes bypassCache: true when nocache is set", async () => {
    const reload = vi.fn();
    const tabs = [{ id: 10 }, { id: 20 }];
    const { unit } = tabUnitOver(tabs, {}, { reload });
    const handler = unit.handlers["reloadTab"];
    expectDefined(handler);
    await handler(
      { repeats: 1, nocache: true },
      { tab: { id: 10, index: 0, windowId: 1 } },
      vi.fn(),
    );
    expect(reload).toHaveBeenCalledWith(10, { bypassCache: true });
  });
});

// ---------------------------------------------------------------------------
// closeTabsToRight / closeTabsToLeft
// ---------------------------------------------------------------------------

describe("closeTabsToRight", () => {
  it("removes all tabs to the right of the sender tab", async () => {
    const remove = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const { unit } = tabUnitOver(tabs, {}, { remove });
    const handler = unit.handlers["closeTabsToRight"];
    expectDefined(handler);
    // sender is at index 1 (id=2); tabs to the right: id=3, id=4
    await handler({}, { tab: { id: 2, index: 1 } }, vi.fn());
    expect(remove).toHaveBeenCalledWith([3, 4]);
  });
});

describe("closeTabsToLeft", () => {
  it("removes all tabs to the left of the sender tab", async () => {
    const remove = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const { unit } = tabUnitOver(tabs, {}, { remove });
    const handler = unit.handlers["closeTabsToLeft"];
    expectDefined(handler);
    // sender is at index 2 (id=3); tabs to the left: id=1, id=2
    await handler({}, { tab: { id: 3, index: 2 } }, vi.fn());
    expect(remove).toHaveBeenCalledWith([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// closeTab with focusAfterClosed
// ---------------------------------------------------------------------------

describe("closeTab — focusAfterClosed", () => {
  it("navigates left after closing when focusAfterClosed is 'left'", async () => {
    const remove = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { unit, update } = tabUnitOver(tabs, { focusAfterClosed: "left" }, { remove });
    const handler = unit.handlers["closeTab"];
    expectDefined(handler);
    await handler({ repeats: 1 }, { tab: { id: 2, index: 1, windowId: 1 } }, vi.fn());
    expect(remove).toHaveBeenCalled();
    // after close, should navigate to previous tab (index - 1 = 0 -> id=1)
    expect(update).toHaveBeenCalledWith(1, { active: true });
  });
});

// ---------------------------------------------------------------------------
// newTabUrl is propagated
// ---------------------------------------------------------------------------

describe("newTabUrl", () => {
  it("is set to the value returned by browser.setNewTabUrl()", () => {
    const { unit } = tabUnitOver([]);
    expect(unit.newTabUrl).toBe("about:newtab");
  });
});

// ---------------------------------------------------------------------------
// sendTabMessage — frameId === -1 uses undefined opts
// ---------------------------------------------------------------------------

describe("sendTabMessage — opts argument", () => {
  it("passes undefined opts when frameId is -1", () => {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const { unit } = tabUnitOver([], {}, { sendMessage });
    unit.sendTabMessage(5, -1, { subject: "focusFrame" });
    // third arg to sendMessage should be undefined
    expect(sendMessage).toHaveBeenCalledWith(5, { subject: "focusFrame" }, undefined);
  });

  it("passes {frameId} opts when frameId is not -1", () => {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const { unit } = tabUnitOver([], {}, { sendMessage });
    unit.sendTabMessage(5, 0, { subject: "tabActivated" });
    expect(sendMessage).toHaveBeenCalledWith(5, { subject: "tabActivated" }, { frameId: 0 });
  });

  it("still forwards the message when sendMessage returns no promise (falsy-p arm)", () => {
    // The falsy `p` arm skips the Result.try promise wrap; the only observable
    // contract is that the underlying sendMessage is still invoked with the
    // resolved opts, so pin that rather than a bare "does not throw".
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const { unit } = tabUnitOver([], {}, { sendMessage });
    unit.sendTabMessage(5, 0, { subject: "tabActivated" });
    expect(sendMessage).toHaveBeenCalledWith(5, { subject: "tabActivated" }, { frameId: 0 });
  });
});

// ---------------------------------------------------------------------------
// tabActivated — same-tab no-op and null lastActiveTabId arms
// ---------------------------------------------------------------------------

describe("tabActivated — branch arms", () => {
  /**
   * Builds a unit where onActivated captures the listener so we can fire it directly to exercise
   * tabActivated's internal branches.
   */
  function buildWithOnActivated() {
    let onActivatedCb: ((info: any) => void) | null = null;
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const noopListener = makeNoopListener();
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
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      sendMessage,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      conf: {},
      browser: { setNewTabUrl: () => "about:newtab", detectTabTitleChange: false },
      handlers: {},
    });
    Object.assign({}, unit.handlers);
    return { unit, sendMessage, onActivatedCb: () => onActivatedCb! };
  }

  it("does not send a deactivate message when there is no previously active tab", () => {
    const { sendMessage, onActivatedCb } = buildWithOnActivated();
    // First activation: no prior tab, so no tabDeactivated message
    onActivatedCb()({ tabId: 10 });
    const subjects = sendMessage.mock.calls.map((c) => c[1]?.subject);
    expect(subjects).not.toContain("tabDeactivated");
    expect(subjects).toContain("tabActivated");
  });

  it("sends tabDeactivated to the previous tab when a new tab is activated", () => {
    const { sendMessage, onActivatedCb } = buildWithOnActivated();
    onActivatedCb()({ tabId: 10 });
    sendMessage.mockClear();
    onActivatedCb()({ tabId: 20 });
    // tabDeactivated should go to tab 10
    const deactivateCalls = sendMessage.mock.calls.filter(
      (c) => c[1]?.subject === "tabDeactivated",
    );
    expect(deactivateCalls).toHaveLength(1);
    expect(deactivateCalls[0]![0]).toBe(10);
  });

  it("does nothing when the same tab is activated again", () => {
    const { sendMessage, onActivatedCb } = buildWithOnActivated();
    onActivatedCb()({ tabId: 10 });
    sendMessage.mockClear();
    // Second activation of the same tab — no messages should be sent
    onActivatedCb()({ tabId: 10 });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onUpdated listener branches
// ---------------------------------------------------------------------------

describe("onUpdated listener — branch arms", () => {
  function buildWithOnUpdated(detectTabTitleChange: boolean, conf: Record<string, any> = {}) {
    let onUpdatedCb: ((tabId: number, changeInfo: any, tab: any) => void) | null = null;
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const noopListener = makeNoopListener();
    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: {
        addListener: (cb: (tabId: number, changeInfo: any, tab: any) => void) => {
          onUpdatedCb = cb;
        },
      },
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      sendMessage,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    createTabs({
      conf,
      browser: { setNewTabUrl: () => "about:newtab", detectTabTitleChange },
      handlers: {},
    });
    return { sendMessage, onUpdatedCb: () => onUpdatedCb! };
  }

  it("does not send tabActivated when status is complete but tab is not active", () => {
    const { sendMessage, onUpdatedCb } = buildWithOnUpdated(false);
    onUpdatedCb()(7, { status: "complete" }, { active: false });
    const subjects = sendMessage.mock.calls.map((c) => c[1]?.subject);
    expect(subjects).not.toContain("tabActivated");
  });

  it("does not send tabActivated when status is not complete", () => {
    const { sendMessage, onUpdatedCb } = buildWithOnUpdated(false);
    onUpdatedCb()(7, { status: "loading" }, { active: true });
    const subjects = sendMessage.mock.calls.map((c) => c[1]?.subject);
    expect(subjects).not.toContain("tabActivated");
  });

  it("sends titleChanged when detectTabTitleChange is true and changeInfo has a title", () => {
    const { sendMessage, onUpdatedCb } = buildWithOnUpdated(true);
    onUpdatedCb()(7, { status: "loading", title: "New Title" }, { active: false });
    const titleCalls = sendMessage.mock.calls.filter((c) => c[1]?.subject === "titleChanged");
    expect(titleCalls).toHaveLength(1);
    expect(titleCalls[0]![0]).toBe(7);
  });

  it("does not send titleChanged when detectTabTitleChange is false", () => {
    const { sendMessage, onUpdatedCb } = buildWithOnUpdated(false);
    onUpdatedCb()(7, { status: "loading", title: "New Title" }, { active: false });
    const subjects = sendMessage.mock.calls.map((c) => c[1]?.subject);
    expect(subjects).not.toContain("titleChanged");
  });

  it("does not send titleChanged when changeInfo has no title", () => {
    const { sendMessage, onUpdatedCb } = buildWithOnUpdated(true);
    onUpdatedCb()(7, { status: "loading" }, { active: false });
    const subjects = sendMessage.mock.calls.map((c) => c[1]?.subject);
    expect(subjects).not.toContain("titleChanged");
  });
});

// ---------------------------------------------------------------------------
// getActiveTab — empty tabs array arm
// ---------------------------------------------------------------------------

describe("getActiveTab — no active tab", () => {
  it("does not call the callback when query returns an empty array", async () => {
    // togglePinTab calls getActiveTab; with empty tabs, update should not be called.
    const { unit, update } = tabUnitOver([]);
    const handler = unit.handlers["togglePinTab"];
    expectDefined(handler);
    await handler({}, {}, vi.fn());
    // The query returns [] so the active tab is undefined, hence no update call
    expect(update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onCommand listener — restartext and closeTab commands
// ---------------------------------------------------------------------------

describe("onCommand listener", () => {
  function buildWithOnCommand(tabs: any[]) {
    let onCommandCb: ((command: string) => void | Promise<void>) | null = null;
    const reload = vi.fn();
    const runtimeReload = vi.fn();
    const remove = vi.fn();
    const noopListener = makeNoopListener();
    const update = vi.fn();
    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query: vi.fn().mockResolvedValue(tabs),
      update,
      reload,
      remove,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = {
      onCommand: {
        addListener: (cb: (command: string) => void | Promise<void>) => {
          onCommandCb = cb;
        },
      },
    };
    g.chrome.runtime = { reload: runtimeReload };
    createTabs({
      conf: {},
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });
    return { onCommandCb: () => onCommandCb!, reload, runtimeReload, remove, update };
  }

  it("reloads all tabs and the runtime for the restartext command", async () => {
    const tabs = [{ id: 1 }, { id: 2 }];
    const { onCommandCb, reload, runtimeReload } = buildWithOnCommand(tabs);
    await onCommandCb()("restartext");
    expect(reload).toHaveBeenCalledWith(1);
    expect(reload).toHaveBeenCalledWith(2);
    expect(runtimeReload).toHaveBeenCalled();
  });

  it("removes the active tab for the closeTab command", async () => {
    const tabs = [{ id: 7, active: true }];
    const { onCommandCb, remove } = buildWithOnCommand(tabs);
    await onCommandCb()("closeTab");
    expect(remove).toHaveBeenCalledWith(7);
  });

  it("does not call any API for an unrecognized command", async () => {
    const { onCommandCb, reload, runtimeReload, remove } = buildWithOnCommand([]);
    await onCommandCb()("unknownCommand");
    expect(reload).not.toHaveBeenCalled();
    expect(runtimeReload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeTab — drains the URL queue when a tab is removed
// ---------------------------------------------------------------------------

describe("removeTab — URL queue drain", () => {
  it("creates a new tab from the queue when a tab is removed and the queue is non-empty", () => {
    let onRemovedCb: ((tabId: number) => void) | null = null;
    const create = vi.fn();
    const noopListener = makeNoopListener();
    g.chrome.tabs = {
      onRemoved: {
        addListener: (cb: (tabId: number) => void) => {
          onRemovedCb = cb;
        },
      },
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      conf: {},
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });
    // Queue a URL first
    unit.handlers["queueURLs"]!({ urls: ["https://queued.com"] }, {}, vi.fn());
    // Now fire onRemoved
    onRemovedCb!(42);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://queued.com", active: false }),
    );
    // Queue should be empty afterwards
    const result = unit.handlers["getQueueURLs"]!({}, {}, vi.fn());
    expect(result).toEqual({ queueURLs: [] });
  });
});

// ---------------------------------------------------------------------------
// closeAudibleTab — empty tabs guard
// ---------------------------------------------------------------------------

describe("closeAudibleTab", () => {
  it("removes the first audible tab when one exists", async () => {
    const remove = vi.fn();
    const { unit } = tabUnitOver([{ id: 55, audible: true }], {}, { remove });
    const handler = unit.handlers["closeAudibleTab"];
    expectDefined(handler);
    await handler({}, {}, vi.fn());
    expect(remove).toHaveBeenCalledWith(55);
  });
});

// ---------------------------------------------------------------------------
// goToLastTab — no history (null previousTab)
// ---------------------------------------------------------------------------

describe("goToLastTab — no history", () => {
  it("does not call tabs.update when tabHistory has no previous tab", () => {
    const { unit, update } = tabUnitOver([]);
    const handler = unit.handlers["goToLastTab"];
    expectDefined(handler);
    // No activations recorded → previousTab() returns null
    handler({}, {}, vi.fn());
    expect(update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// closeTab — focusAfterClosed === "last" paths
// ---------------------------------------------------------------------------

describe("closeTab — focusAfterClosed === 'last'", () => {
  it("calls the historyTab handler when focusAfterClosed is 'last'", async () => {
    const remove = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { unit, handlers } = tabUnitOver(tabs, { focusAfterClosed: "last" }, { remove });
    const historyTabSpy = vi.fn();
    // Override the historyTab handler so we can observe the call
    handlers["historyTab"] = historyTabSpy;

    const handler = unit.handlers["closeTab"];
    expectDefined(handler);
    await handler({ repeats: 1 }, { tab: { id: 2, index: 1, windowId: 1 } }, vi.fn());
    expect(remove).toHaveBeenCalled();
    expect(historyTabSpy).toHaveBeenCalledWith({ backward: true });
  });

  it("still removes the tab when focusAfterClosed is 'last' but the historyTab handler is absent", async () => {
    const remove = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }];
    const { unit, handlers } = tabUnitOver(tabs, { focusAfterClosed: "last" }, { remove });
    // Drop the historyTab handler so the `if (historyTab)` guard takes its
    // falsy arm; the tab must still close (remove called) even though no
    // history navigation is dispatched.
    delete handlers["historyTab"];

    const handler = unit.handlers["closeTab"];
    expectDefined(handler);
    await handler({ repeats: 1 }, { tab: { id: 2, index: 1, windowId: 1 } }, vi.fn());
    expect(remove).toHaveBeenCalledWith([2]);
  });

  it("does nothing for focusAfterClosed when it is neither 'left' nor 'last'", async () => {
    const remove = vi.fn();
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { unit, update } = tabUnitOver(tabs, { focusAfterClosed: "right" }, { remove });
    const handler = unit.handlers["closeTab"];
    expectDefined(handler);
    await handler({ repeats: 1 }, { tab: { id: 2, index: 1, windowId: 1 } }, vi.fn());
    expect(update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getTabs — MRU sort with tabActivated fallback (no lastAccessed on some tabs)
// ---------------------------------------------------------------------------

describe("getTabs — MRU sort tabActivated fallback", () => {
  it("pushes tabs with no lastAccessed and no tabActivated entry to the end", async () => {
    // This test exercises the `!isFinite(a) && !isFinite(b)` (return 0) and
    // `!isFinite(a)` (return 1) sort comparator arms.
    const tabs = [
      { id: 1, url: "https://a.com", title: "A", lastAccessed: 1000 },
      { id: 2, url: "https://b.com", title: "B" }, // no lastAccessed, no tabActivated → NaN
      { id: 3, url: "https://c.com", title: "C" }, // no lastAccessed, no tabActivated → NaN
      { id: 99, url: "https://cur.com", title: "Cur" }, // sender, excluded
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
      query: vi.fn().mockResolvedValue(tabs),
      update: vi.fn(),
      sendMessage: vi.fn().mockReturnValue(undefined),
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      conf: { tabsMRUOrder: true },
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });

    const handler = unit.handlers["getTabs"];
    expectDefined(handler);
    const result = (await handler(
      { filter: "", tabsThreshold: 2, queryInfo: {} },
      { tab: { id: 99 } },
      vi.fn(),
    )) as { tabs: any[] };
    // tab 1 has lastAccessed=1000 → first; tabs 2 and 3 have NaN → sorted to end
    expect(result.tabs[0]!.id).toBe(1);
    // tabs 2 and 3 both lack access time → end (order between them is stable/equal = 0 return)
    const endIds = result.tabs.slice(1).map((t) => t.id);
    expect(endIds).toEqual(expect.arrayContaining([2, 3]));
  });

  it("uses tabActivated timestamp as a fallback when lastAccessed is absent", async () => {
    // Exercises the `x.lastAccessed || tabActivated[x.id]` fallback arm.
    const tabs = [
      { id: 1, url: "https://a.com", title: "A" }, // will get tabActivated timestamp
      { id: 2, url: "https://b.com", title: "B" }, // no source → NaN → sinks to end
      { id: 99, url: "https://cur.com", title: "Cur" }, // sender
    ];
    const noopListener = makeNoopListener();
    let onActivatedCb: ((info: any) => void) | null = null;
    const sendMessage = vi.fn().mockReturnValue(undefined);
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
      query: vi.fn().mockResolvedValue(tabs),
      update: vi.fn(),
      sendMessage,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      conf: { tabsMRUOrder: true },
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });
    // Record activation of tab 1 to populate tabActivated map
    onActivatedCb!({ tabId: 1 });

    const handler = unit.handlers["getTabs"];
    expectDefined(handler);
    const result = (await handler(
      { filter: "", tabsThreshold: 1, queryInfo: {} },
      { tab: { id: 99 } },
      vi.fn(),
    )) as { tabs: any[] };
    // tab 1 has a tabActivated timestamp (finite) → comes before tab 2 (NaN → sinks)
    expect(result.tabs[0]!.id).toBe(1);
    expect(result.tabs[1]!.id).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// setZoom — zero and non-zero zoomFactor branches
// ---------------------------------------------------------------------------

describe("setZoom", () => {
  it("resets zoom to defaultZoomFactor when zoomFactor is 0", async () => {
    const setZoom = vi.fn();
    const getZoomSettings = vi.fn().mockResolvedValue({ defaultZoomFactor: 1.5 });
    const { unit } = tabUnitOver([], {}, { setZoom, getZoomSettings });
    const handler = unit.handlers["setZoom"];
    expectDefined(handler);
    await handler({ zoomFactor: 0, repeats: 1 }, { tab: { id: 3 } }, vi.fn());
    expect(getZoomSettings).toHaveBeenCalledWith(3);
    expect(setZoom).toHaveBeenCalledWith(3, 1.5);
  });

  it("falls back to zoom factor 1 when defaultZoomFactor is falsy", async () => {
    const setZoom = vi.fn();
    const getZoomSettings = vi.fn().mockResolvedValue({});
    const { unit } = tabUnitOver([], {}, { setZoom, getZoomSettings });
    const handler = unit.handlers["setZoom"];
    expectDefined(handler);
    await handler({ zoomFactor: 0, repeats: 1 }, { tab: { id: 3 } }, vi.fn());
    expect(setZoom).toHaveBeenCalledWith(3, 1);
  });

  it("adjusts the current zoom by zoomFactor when zoomFactor is non-zero", async () => {
    const setZoom = vi.fn();
    const getZoom = vi.fn().mockResolvedValue(1);
    const { unit } = tabUnitOver([], {}, { setZoom, getZoom });
    const handler = unit.handlers["setZoom"];
    expectDefined(handler);
    await handler({ zoomFactor: 0.1, repeats: 2 }, { tab: { id: 4 } }, vi.fn());
    expect(getZoom).toHaveBeenCalledWith(4);
    expect(setZoom).toHaveBeenCalledWith(4, expect.closeTo(1.2, 5));
  });
});

// ---------------------------------------------------------------------------
// setScrollPos / tabMessages — already-present entry path
// ---------------------------------------------------------------------------

describe("setScrollPos — tabMessages branch", () => {
  it("sends setScrollPos and removes entry when the tab has a stored message", () => {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const { unit } = tabUnitOver([], {}, { sendMessage });
    // Store a scroll position for tab 77
    unit.tabMessages[77] = { scrollLeft: 10, scrollTop: 20 };
    unit.setScrollPos(77);
    expect(sendMessage).toHaveBeenCalledWith(
      77,
      expect.objectContaining({ subject: "setScrollPos", scrollLeft: 10, scrollTop: 20 }),
      { frameId: 0 },
    );
    // Entry should be removed after sending
    expect(unit.tabMessages[77]).toBeUndefined();
  });

  it("does nothing when there is no stored message for the tab", () => {
    const sendMessage = vi.fn();
    const { unit } = tabUnitOver([], {}, { sendMessage });
    unit.setScrollPos(99);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// openLink — tabbed via omnibar (frameId !== 0 from frontend.html)
// ---------------------------------------------------------------------------

describe("openLink — tabbed from omnibar sender", () => {
  it("fetches the active tab via getActiveTab when sender is the omnibar frame", async () => {
    const create = vi.fn();
    const activeTabs = [{ id: 50, index: 0, pinned: false }];
    // query must resolve the active tab for getActiveTab to work
    const query = vi.fn().mockResolvedValue(activeTabs);
    const noopListener = makeNoopListener();
    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query,
      update: vi.fn(),
      create,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    g.chrome.runtime = { getURL: (path: string) => "chrome-extension://abcdef" + path };
    const unit = createTabs({
      conf: {},
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      { url: "https://target.com", tab: { tabbed: true, active: true, pinned: false } },
      {
        tab: { id: 10, pinned: false },
        frameId: 1, // non-zero frame
        url: "chrome-extension://abcdef/frontend.html",
      },
      vi.fn(),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: "https://target.com" }));
  });
});

// ---------------------------------------------------------------------------
// openUrlInNewTab — scrollLeft/scrollTop stored in tabMessages
// ---------------------------------------------------------------------------

describe("openUrlInNewTab — scroll position stored", () => {
  it("stores scrollLeft/scrollTop in tabMessages when they are set on the message", async () => {
    const create = vi.fn().mockResolvedValue({ id: 999 });
    const { unit } = tabUnitOver([], {}, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      {
        url: "https://example.com",
        tab: { tabbed: true, active: true, pinned: false },
        scrollLeft: 100,
        scrollTop: 200,
      },
      { tab: { id: 1, index: 0, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(unit.tabMessages[999]).toEqual({ scrollLeft: 100, scrollTop: 200 });
  });

  it("does not store scroll position when both are absent/zero", async () => {
    const create = vi.fn().mockResolvedValue({ id: 888 });
    const { unit } = tabUnitOver([], {}, { create });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      { url: "https://example.com", tab: { tabbed: true, active: true, pinned: false } },
      { tab: { id: 1, index: 0, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(unit.tabMessages[888]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// openLink — non-tabbed with scrollLeft/scrollTop
// ---------------------------------------------------------------------------

describe("openLink — non-tabbed scroll storage", () => {
  it("stores scroll position for the current tab when not tabbed", async () => {
    const update = vi.fn().mockResolvedValue({ id: 77 });
    const { unit } = tabUnitOver([], {}, { update });
    const handler = unit.handlers["openLink"];
    expectDefined(handler);
    await handler(
      {
        url: "https://example.com",
        tab: { tabbed: false, pinned: false },
        scrollLeft: 5,
        scrollTop: 0,
      },
      { tab: { id: 77, pinned: false }, frameId: 0, url: "https://other.com" },
      vi.fn(),
    );
    expect(unit.tabMessages[77]).toEqual({ scrollLeft: 5, scrollTop: 0 });
  });
});

// ---------------------------------------------------------------------------
// viewSource — openLink handler absent (no-op)
// ---------------------------------------------------------------------------

describe("viewSource — openLink handler absent", () => {
  it("opens no link when the openLink handler is absent", async () => {
    const create = vi.fn();
    const { unit, handlers } = tabUnitOver([], {}, { create });
    // Drop openLink so the `if (openLink)` guard takes its falsy arm; with no
    // handler to delegate to, viewSource must not reach chrome.tabs.create.
    const saved = handlers["openLink"];
    delete handlers["openLink"];
    const handler = unit.handlers["viewSource"];
    expectDefined(handler);
    await handler(
      { tab: { tabbed: true, active: true, pinned: false } },
      { tab: { id: 1, url: "https://example.com", pinned: false }, frameId: 0 },
      vi.fn(),
    );
    expect(create).not.toHaveBeenCalled();
    handlers["openLink"] = saved;
  });
});

// ---------------------------------------------------------------------------
// nextFrame handler
// ---------------------------------------------------------------------------

describe("nextFrame", () => {
  function buildWithExecuteScript(results: any[]) {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    const executeScript = vi.fn().mockResolvedValue(results);
    const noopListener = makeNoopListener();
    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      sendMessage,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    g.chrome.scripting = { executeScript };
    const unit = createTabs({
      conf: {},
      browser: { setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });
    return { unit, sendMessage };
  }

  it("sends focusFrame to the next frame in the list", async () => {
    const { unit, sendMessage } = buildWithExecuteScript([{ result: 1 }, { result: 2 }]);
    const handler = unit.handlers["nextFrame"];
    expectDefined(handler);
    // frames 1 and 2; frameId 1 is current → next is 2
    await handler({ frameId: 1 }, { tab: { id: 5 } }, vi.fn());
    const focusCalls = sendMessage.mock.calls.filter((c) => c[1]?.subject === "focusFrame");
    expect(focusCalls).toHaveLength(1);
    expect(focusCalls[0]![2]).toBeUndefined(); // frameId -1 → undefined opts
    expect(focusCalls[0]![1].frameId).toBe(2);
  });

  it("wraps around to frameId 0 when the current frame is the last one", async () => {
    const { unit, sendMessage } = buildWithExecuteScript([{ result: 1 }, { result: 2 }]);
    const handler = unit.handlers["nextFrame"];
    expectDefined(handler);
    // Current frame (2) is the last → wrap to index 0 → frameId 1
    await handler({ frameId: 2 }, { tab: { id: 5 } }, vi.fn());
    const focusCall = sendMessage.mock.calls.find((c) => c[1]?.subject === "focusFrame");
    expect(focusCall![1].frameId).toBe(1);
  });

  it("does nothing when executeScript returns no non-zero frames", async () => {
    const { unit, sendMessage } = buildWithExecuteScript([{ result: 0 }, { result: 0 }]);
    const handler = unit.handlers["nextFrame"];
    expectDefined(handler);
    // All results are 0 → filter removes them → framesInTab.length === 0
    await handler({ frameId: 0 }, { tab: { id: 5 } }, vi.fn());
    const focusCalls = sendMessage.mock.calls.filter((c) => c[1]?.subject === "focusFrame");
    expect(focusCalls).toHaveLength(0);
  });
});
