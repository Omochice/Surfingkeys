import { afterEach, describe, expect, it, vi } from "vitest";

import { createHistoryHandlers } from "../src/background/history";

type AnyChrome = { history?: any; topSites?: any; sessions?: any; bookmarks?: any };
const g = globalThis as unknown as { chrome: AnyChrome };

afterEach(() => {
  delete g.chrome.history;
  delete g.chrome.topSites;
  delete g.chrome.sessions;
  delete g.chrome.bookmarks;
});

function lastResult(respond: ReturnType<typeof vi.fn>): any {
  return respond.mock.calls[respond.mock.calls.length - 1][2];
}

/** A browser stub whose history search returns a fixed list. */
function browserWith(items: any[]) {
  return {
    getLatestHistoryItem: (_text: string, _max: number, cb: (items: any[]) => void) => cb(items),
  };
}

// The injected filter is exercised by start.ts; here it is identity so the
// handler's own shaping is what gets asserted.
const identityFilter = (items: any[]) => items;

describe("createHistoryHandlers", () => {
  it("getRecentlyClosed flattens both window and single-tab sessions", () => {
    g.chrome.sessions = {
      getRecentlyClosed: (_opts: any, cb: (s: any[]) => void) =>
        cb([
          { window: { tabs: [{ url: "https://a" }, { url: "https://b" }] } },
          { tab: { url: "https://c" } },
        ]),
    };
    const respond = vi.fn();
    createHistoryHandlers(respond, browserWith([]), identityFilter).getRecentlyClosed!(
      { query: "" },
      {},
      vi.fn(),
    );

    expect(lastResult(respond).urls.map((t: any) => t.url)).toEqual([
      "https://a",
      "https://b",
      "https://c",
    ]);
  });

  it("getTopSites responds with an empty list when chrome.topSites is unavailable", () => {
    const respond = vi.fn();
    createHistoryHandlers(respond, browserWith([]), identityFilter).getTopSites!(
      { query: "" },
      {},
      vi.fn(),
    );

    expect(lastResult(respond)).toEqual({ urls: [] });
  });

  it("getHistory sorts by visit count when sortByMostUsed is set", () => {
    const respond = vi.fn();
    const browser = browserWith([
      { url: "https://low", visitCount: 1 },
      { url: "https://high", visitCount: 9 },
    ]);
    createHistoryHandlers(respond, browser, identityFilter).getHistory!(
      { sortByMostUsed: true },
      {},
      vi.fn(),
    );

    expect(lastResult(respond).history.map((h: any) => h.url)).toEqual([
      "https://high",
      "https://low",
    ]);
  });

  it("getAllURLs concatenates bookmarks with history up to maxResults", () => {
    g.chrome.bookmarks = {
      search: (_q: any, cb: (b: any[]) => void) => cb([{ url: "https://bm" }]),
    };
    const respond = vi.fn();
    const browser = browserWith([{ url: "https://h1" }, { url: "https://h2" }]);
    createHistoryHandlers(respond, browser, identityFilter).getAllURLs!(
      { maxResults: 3 },
      {},
      vi.fn(),
    );

    expect(lastResult(respond).urls.map((u: any) => u.url)).toEqual([
      "https://bm",
      "https://h1",
      "https://h2",
    ]);
  });

  it("getAllURLs slices bookmarks to the requested count when history is not needed", () => {
    g.chrome.bookmarks = {
      search: (_q: any, cb: (b: any[]) => void) =>
        cb([{ url: "https://1" }, { url: "https://2" }, { url: "https://3" }]),
    };
    const respond = vi.fn();
    createHistoryHandlers(respond, browserWith([]), identityFilter).getAllURLs!(
      { maxResults: 2 },
      {},
      vi.fn(),
    );

    expect(lastResult(respond).urls).toHaveLength(2);
  });

  it("addHistories forwards each url to chrome.history.addUrl", () => {
    const addUrl = vi.fn();
    g.chrome.history = { addUrl };
    createHistoryHandlers(vi.fn(), browserWith([]), identityFilter).addHistories!(
      { history: ["https://a", "https://b"] },
      {},
      vi.fn(),
    );

    expect(addUrl.mock.calls.map((c) => c[0])).toEqual([
      { url: "https://a" },
      { url: "https://b" },
    ]);
  });
});
