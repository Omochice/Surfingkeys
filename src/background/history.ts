import type { MessageHandler } from "./start";

/**
 * History, top-sites and recently-closed search handlers backing the omnibar. These are stateless
 * read queries against chrome.history/topSites/sessions. The browser-specific history search and
 * the shared tab/url filter are injected; handlers resolve to their response payload and the
 * dispatcher in `start` settles the sender.
 */
export function createHistoryHandlers(
  browser: any,
  _filterByTitleOrUrl: (items: any[], query: string) => any[],
): Record<string, MessageHandler> {
  async function _getHistory(text: string, maxResults: number, sortByMostUsed?: boolean) {
    const items: any[] = await browser.getLatestHistoryItem(text, maxResults);
    if (sortByMostUsed) {
      return items.sort((a, b) => b.visitCount - a.visitCount);
    }
    return items;
  }

  return {
    getRecentlyClosed: async (message: any) => {
      const sessions: any[] = await chrome.sessions.getRecentlyClosed({});
      let tabs: any[] = [];
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (Object.hasOwn(s, "window")) {
          tabs = tabs.concat(s.window.tabs);
        } else if (Object.hasOwn(s, "tab")) {
          tabs.push(s.tab);
        }
      }
      return { urls: _filterByTitleOrUrl(tabs, message.query) };
    },
    getTopSites: async (message: any) => {
      if (chrome.topSites) {
        return { urls: _filterByTitleOrUrl(await chrome.topSites.get(), message.query) };
      }
      return { urls: [] };
    },
    getAllURLs: async (message: any) => {
      const urls: any[] = await chrome.bookmarks.search(message.query || {});
      const requestCount = message.maxResults || 100;
      const maxResults = requestCount - urls.length;
      if (maxResults > 0) {
        const historyItems = await _getHistory(message.query || "", maxResults, true);
        return { urls: urls.concat(historyItems) };
      }
      return { urls: urls.slice(0, requestCount) };
    },
    getHistory: async (message: any) => {
      const history = await _getHistory(
        message.query || "",
        message.maxResults || 100,
        message.sortByMostUsed,
      );
      return { history };
    },
    addHistories: (message: any) => {
      message.history.forEach((h: string) => {
        chrome.history.addUrl({ url: h });
      });
    },
    deleteHistoryOlderThan: (message: any) => {
      const days = message.days || 0;
      const hours = message.hours || 0;
      chrome.history.deleteRange({
        startTime: 0,
        endTime: new Date().getTime() - (days * 86400 + hours * 3600) * 1000,
      });
    },
  };
}
