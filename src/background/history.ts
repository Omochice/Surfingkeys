import * as v from "valibot";

import type { MessageHandler } from "./start";

// Search/history request payloads cross the chrome.runtime boundary, so each is
// validated before its fields are consumed.
const searchQuerySchema = v.object({ query: v.optional(v.string()) });
const getAllURLsSchema = v.object({
  query: v.optional(v.string()),
  maxResults: v.optional(v.number()),
});
const getHistorySchema = v.object({
  query: v.optional(v.string()),
  maxResults: v.optional(v.number()),
  sortByMostUsed: v.optional(v.boolean()),
});
const addHistoriesSchema = v.object({ history: v.array(v.string()) });
const deleteHistoryOlderThanSchema = v.object({
  days: v.optional(v.number()),
  hours: v.optional(v.number()),
});

type HistoryBrowser = {
  getLatestHistoryItem(text: string, maxResults: number): Promise<chrome.history.HistoryItem[]>;
};
type FilterByTitleOrUrl = <T extends { title?: string | undefined; url?: string | undefined }>(
  items: readonly T[],
  query: string,
) => readonly T[];

/**
 * History, top-sites and recently-closed search handlers backing the omnibar. These are stateless
 * read queries against chrome.history/topSites/sessions. The browser-specific history search and
 * the shared tab/url filter are injected; handlers resolve to their response payload and the
 * dispatcher in `start` settles the sender.
 */
export function createHistoryHandlers(
  browser: HistoryBrowser,
  _filterByTitleOrUrl: FilterByTitleOrUrl,
): Record<string, MessageHandler> {
  async function _getHistory(text: string, maxResults: number, sortByMostUsed?: boolean) {
    const items = await browser.getLatestHistoryItem(text, maxResults);
    if (sortByMostUsed) {
      return items.toSorted((a, b) => (b.visitCount ?? 0) - (a.visitCount ?? 0));
    }
    return items;
  }

  return {
    getRecentlyClosed: async (message: unknown) => {
      const { query } = v.parse(searchQuerySchema, message);
      const sessions = await chrome.sessions.getRecentlyClosed({});
      let tabs: chrome.tabs.Tab[] = [];
      for (const s of sessions) {
        if (s.window?.tabs) {
          tabs = tabs.concat(s.window.tabs);
        } else if (s.tab) {
          tabs.push(s.tab);
        }
      }
      return { urls: _filterByTitleOrUrl(tabs, query ?? "") };
    },
    getTopSites: async (message: unknown) => {
      const { query } = v.parse(searchQuerySchema, message);
      if (chrome.topSites) {
        return { urls: _filterByTitleOrUrl(await chrome.topSites.get(), query ?? "") };
      }
      return { urls: [] };
    },
    getAllURLs: async (message: unknown) => {
      const params = v.parse(getAllURLsSchema, message);
      const urls: (chrome.bookmarks.BookmarkTreeNode | chrome.history.HistoryItem)[] =
        await chrome.bookmarks.search(params.query || {});
      const requestCount = params.maxResults || 100;
      const maxResults = requestCount - urls.length;
      if (maxResults > 0) {
        const historyItems = await _getHistory(params.query || "", maxResults, true);
        return { urls: urls.concat(historyItems) };
      }
      return { urls: urls.slice(0, requestCount) };
    },
    getHistory: async (message: unknown) => {
      const { query, maxResults, sortByMostUsed } = v.parse(getHistorySchema, message);
      const history = await _getHistory(query || "", maxResults || 100, sortByMostUsed);
      return { history };
    },
    addHistories: (message: unknown) => {
      const { history } = v.parse(addHistoriesSchema, message);
      history.forEach((h) => {
        chrome.history.addUrl({ url: h });
      });
    },
    deleteHistoryOlderThan: (message: unknown) => {
      const { days, hours } = v.parse(deleteHistoryOlderThanSchema, message);
      chrome.history.deleteRange({
        startTime: 0,
        endTime: Date.now() - ((days || 0) * 86_400 + (hours || 0) * 3600) * 1000,
      });
    },
  };
}
