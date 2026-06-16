import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../../test/helpers";
import { createHistoryHandlers } from "./history";

type AnyChrome = {
  history?: unknown;
  topSites?: unknown;
  sessions?: unknown;
  bookmarks?: unknown;
};
const g = globalThis as unknown as { chrome: AnyChrome };

afterEach(() => {
  delete g.chrome.history;
  delete g.chrome.topSites;
  delete g.chrome.sessions;
  delete g.chrome.bookmarks;
});

/** A browser stub whose history search resolves a fixed list. */
function browserWith(items: any[]) {
  return {
    getLatestHistoryItem: vi.fn().mockResolvedValue(items),
  };
}

// The injected filter is exercised by start.ts; here it is identity so the
// handler's own shaping is what gets asserted.
const identityFilter = <T>(items: readonly T[]): readonly T[] => items;

describe("createHistoryHandlers", () => {
  it("getRecentlyClosed flattens both window and single-tab sessions", async () => {
    g.chrome.sessions = {
      getRecentlyClosed: vi
        .fn()
        .mockResolvedValue([
          { window: { tabs: [{ url: "https://a" }, { url: "https://b" }] } },
          { tab: { url: "https://c" } },
        ]),
    };
    const getRecentlyClosed = createHistoryHandlers(browserWith([]), identityFilter)[
      "getRecentlyClosed"
    ];
    expectDefined(getRecentlyClosed);
    const result: { urls: { url?: string }[] } = await getRecentlyClosed(
      { query: "" },
      {},
      vi.fn(),
    );

    expect(result.urls.map((t) => t.url)).toEqual(["https://a", "https://b", "https://c"]);
  });

  it("getTopSites responds with an empty list when chrome.topSites is unavailable", async () => {
    const getTopSites = createHistoryHandlers(browserWith([]), identityFilter)["getTopSites"];
    expectDefined(getTopSites);
    const result = await getTopSites({ query: "" }, {}, vi.fn());

    expect(result).toEqual({ urls: [] });
  });

  it("getHistory sorts by visit count when sortByMostUsed is set", async () => {
    const browser = browserWith([
      { url: "https://low", visitCount: 1 },
      { url: "https://high", visitCount: 9 },
    ]);
    const getHistory = createHistoryHandlers(browser, identityFilter)["getHistory"];
    expectDefined(getHistory);
    const result: { history: { url?: string }[] } = await getHistory(
      { sortByMostUsed: true },
      {},
      vi.fn(),
    );

    expect(result.history.map((h) => h.url)).toEqual(["https://high", "https://low"]);
  });

  it("getHistory leaves the array returned by the browser unmodified when sorting", async () => {
    const items = [
      { url: "https://low", visitCount: 1 },
      { url: "https://high", visitCount: 9 },
    ];
    const getHistory = createHistoryHandlers(browserWith(items), identityFilter)["getHistory"];
    expectDefined(getHistory);
    await getHistory({ sortByMostUsed: true }, {}, vi.fn());

    expect(items.map((h) => h.url)).toEqual(["https://low", "https://high"]);
  });

  it("getAllURLs concatenates bookmarks with history up to maxResults", async () => {
    g.chrome.bookmarks = {
      search: vi.fn().mockResolvedValue([{ url: "https://bm" }]),
    };
    const browser = browserWith([{ url: "https://h1" }, { url: "https://h2" }]);
    const getAllURLs = createHistoryHandlers(browser, identityFilter)["getAllURLs"];
    expectDefined(getAllURLs);
    const result: { urls: { url?: string }[] } = await getAllURLs({ maxResults: 3 }, {}, vi.fn());

    expect(result.urls.map((u) => u.url)).toEqual(["https://bm", "https://h1", "https://h2"]);
  });

  it("getAllURLs slices bookmarks to the requested count when history is not needed", async () => {
    g.chrome.bookmarks = {
      search: vi
        .fn()
        .mockResolvedValue([{ url: "https://1" }, { url: "https://2" }, { url: "https://3" }]),
    };
    const getAllURLs = createHistoryHandlers(browserWith([]), identityFilter)["getAllURLs"];
    expectDefined(getAllURLs);
    const result = await getAllURLs({ maxResults: 2 }, {}, vi.fn());

    expect(result.urls).toHaveLength(2);
  });

  it("addHistories forwards each url to chrome.history.addUrl", async () => {
    const addUrl = vi.fn();
    g.chrome.history = { addUrl };
    const addHistories = createHistoryHandlers(browserWith([]), identityFilter)["addHistories"];
    expectDefined(addHistories);
    await addHistories({ history: ["https://a", "https://b"] }, {}, vi.fn());

    expect(addUrl.mock.calls.map((c) => c[0])).toEqual([
      { url: "https://a" },
      { url: "https://b" },
    ]);
  });
});
