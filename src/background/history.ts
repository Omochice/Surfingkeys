import type { MessageHandler } from "./start";

/**
 * Sends a (possibly deferred) response for a handled message; injected from the composition root so
 * the unit shares the one pending-port bookkeeping.
 */
type Respond = (message: any, sendResponse: (result: any) => void, result: any) => void;

/**
 * History, top-sites and recently-closed search handlers backing the omnibar. These are stateless
 * read queries against chrome.history/topSites/sessions. The browser-specific history search and
 * the shared tab/url filter are injected, so the unit needs nothing from the composition root but
 * the deferred-response helper.
 */
export function createHistoryHandlers(
  _response: Respond,
  browser: any,
  _filterByTitleOrUrl: (items: any[], query: string) => any[],
): Record<string, MessageHandler> {
  function _getHistory(
    text: string,
    maxResults: number,
    cb: (items: any[]) => void,
    sortByMostUsed?: boolean,
  ) {
    browser.getLatestHistoryItem(text, maxResults, (items: any[]) => {
      if (sortByMostUsed) {
        items = items.sort((a, b) => {
          return b.visitCount - a.visitCount;
        });
      }
      cb(items);
    });
  }

  return {
    getRecentlyClosed: (message: any, _sender: any, sendResponse: any) => {
      chrome.sessions.getRecentlyClosed({}, (sessions: any[]) => {
        let tabs: any[] = [];
        for (let i = 0; i < sessions.length; i++) {
          const s = sessions[i];
          if (Object.prototype.hasOwnProperty.call(s, "window")) {
            tabs = tabs.concat(s.window.tabs);
          } else if (Object.prototype.hasOwnProperty.call(s, "tab")) {
            tabs.push(s.tab);
          }
        }
        tabs = _filterByTitleOrUrl(tabs, message.query);
        _response(message, sendResponse, {
          urls: tabs,
        });
      });
    },
    getTopSites: (message: any, _sender: any, sendResponse: any) => {
      if (chrome.topSites) {
        chrome.topSites.get((urls: any[]) => {
          urls = _filterByTitleOrUrl(urls, message.query);
          _response(message, sendResponse, {
            urls: urls,
          });
        });
      } else {
        _response(message, sendResponse, {
          urls: [],
        });
      }
    },
    getAllURLs: (message: any, _sender: any, sendResponse: any) => {
      chrome.bookmarks.search(message.query || {}, (bmItems: any[]) => {
        let urls = bmItems;
        const requestCount = message.maxResults || 100;
        const maxResults = requestCount - urls.length;
        if (maxResults > 0) {
          _getHistory(
            message.query || "",
            maxResults,
            (historyItems) => {
              urls = urls.concat(historyItems);
              _response(message, sendResponse, {
                urls: urls,
              });
            },
            true,
          );
        } else {
          _response(message, sendResponse, {
            urls: urls.slice(0, requestCount),
          });
        }
      });
    },
    getHistory: (message: any, _sender: any, sendResponse: any) => {
      _getHistory(
        message.query || "",
        message.maxResults || 100,
        (tree) => {
          _response(message, sendResponse, {
            history: tree,
          });
        },
        message.sortByMostUsed,
      );
    },
    addHistories: (message: any, _sender: any, _sendResponse: any) => {
      message.history.forEach((h: string) => {
        chrome.history.addUrl({ url: h });
      });
    },
    deleteHistoryOlderThan: (message: any, _sender: any, _sendResponse: any) => {
      const days = message.days || 0;
      const hours = message.hours || 0;
      chrome.history.deleteRange(
        {
          startTime: 0,
          endTime: new Date().getTime() - (days * 86400 + hours * 3600) * 1000,
        },
        () => {},
      );
    },
  };
}
