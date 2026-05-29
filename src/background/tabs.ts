import { filterByTitleOrUrl } from "../common/utils.js";
import type { MessageHandler } from "./start.js";
import { createTabHistory } from "./tabHistory.js";

// Browser-extension global; background is an untyped chrome.* boundary (see start.ts).
declare const chrome: any;

/**
 * Sends a (possibly deferred) response for a handled message; injected from the composition root so
 * the unit shares the one pending-port bookkeeping.
 */
type Respond = (message: any, sendResponse: (result: any) => void, result: any) => void;

/** Clamps a target index to between 0 and length. */
export function _fixTo(to: number, length: number) {
  if (to < 0) {
    to = 0;
  } else if (to >= length) {
    to = length;
  }
  return to;
}

/** Rounds the base index ahead when a repeat count would overrun the length. */
export function _roundBase(base: number, repeats: number, length: number) {
  if (repeats > length - base) {
    base -= repeats - (length - base);
  }
  return base;
}

/**
 * Dependencies the tab core takes from the composition root: the deferred responder, the shared
 * mutable `conf` (written by settings, read here), the per-browser glue, and the shared `handlers`
 * registry for the two intra-tab cross-calls (viewSource → openLink, closeTab → historyTab).
 */
export type TabsDeps = {
  _response: Respond;
  conf: Record<string, any>;
  browser: any;
  handlers: Record<string, MessageHandler>;
};

/**
 * What the composition root needs back from the tab core: the handler map to register, plus the
 * primitives other units depend on — `sendTabMessage` and `tabMessages`/`setScrollPos`/`newTabUrl`
 * injected into settings, and `filterByTitleOrUrl` injected into the history unit.
 */
export type TabsUnit = {
  handlers: Record<string, MessageHandler>;
  sendTabMessage: (tabId: number, frameId: number, message: any) => void;
  filterByTitleOrUrl: (tabs: any[], query: string) => any[];
  tabMessages: Record<string, any>;
  setScrollPos: (tabId: number) => void;
  newTabUrl: string;
};

/**
 * Tab and window core: the MRU/index/url bookkeeping maps and the tab lifecycle listeners, the
 * navigation/close/move helpers, and every tab- and window-oriented message handler. Owns the
 * queued-URL list because the onRemoved handler drains it. Reads the shared `conf` by reference and
 * reaches the rest of the registry through the injected `handlers` for two cross-calls.
 */
export function createTabs(deps: TabsDeps): TabsUnit {
  const { _response, conf, browser, handlers } = deps;

  const tabHistory = createTabHistory();
  let chromelikeNewTabPosition = 0;

  // data by tab id
  const tabActivated: Record<string, any> = {};
  const tabMessages: Record<string, any> = {};
  const tabURLs: Record<string, any> = {};

  const newTabUrl = browser._setNewTabUrl();

  let _lastActiveTabId: number | null = null;
  let previousWindowChoice = -1;
  let _queueURLs: any[] = [];

  function removeTab(tabId: number) {
    delete tabActivated[tabId];
    delete tabMessages[tabId];
    delete tabURLs[tabId];
    tabHistory.remove(tabId);
    if (_queueURLs.length) {
      chrome.tabs.create({
        active: false,
        url: _queueURLs.shift(),
      });
    }

    _updateTabIndices();
  }
  chrome.tabs.onRemoved.addListener(removeTab);
  function _setScrollPos_bg(tabId: number) {
    if (Object.prototype.hasOwnProperty.call(tabMessages, tabId)) {
      const message = tabMessages[tabId];
      sendTabMessage(tabId, 0, {
        subject: "setScrollPos",
        scrollLeft: message.scrollLeft,
        scrollTop: message.scrollTop,
      });
      delete tabMessages[tabId];
    }
  }

  function sendTabMessage(tabId: number, frameId: number, message: any) {
    const opts = frameId === -1 ? undefined : { frameId: frameId };
    // use catch to suppress Uncaught (in promise) Error on sending message to unsupported tabs like chrome://
    const p = chrome.tabs.sendMessage(tabId, message, opts);
    if (p) {
      p.catch(() => {});
    }
  }
  function _tabActivated(tabId: number) {
    if (_lastActiveTabId !== tabId) {
      if (_lastActiveTabId !== null) {
        sendTabMessage(_lastActiveTabId, 0, {
          subject: "tabDeactivated",
        });
      }
      sendTabMessage(tabId, 0, {
        subject: "tabActivated",
      });
      _lastActiveTabId = tabId;
    }
  }
  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any, tab: any) => {
    if (changeInfo.status === "complete") {
      if (tab.active) {
        _tabActivated(tabId);
      }
    }
    if (browser.detectTabTitleChange && changeInfo.title) {
      sendTabMessage(tabId, 0, {
        subject: "titleChanged",
        changeInfo,
      });
    }
  });
  chrome.windows.onFocusChanged.addListener(() => {
    getActiveTab((tab: any) => {
      _tabActivated(tab.id);
    });
  });

  chrome.tabs.onCreated.addListener(() => {
    _updateTabIndices();
  });
  chrome.tabs.onMoved.addListener(() => {
    _updateTabIndices();
  });
  chrome.tabs.onActivated.addListener((activeInfo: any) => {
    tabHistory.record(activeInfo.tabId);
    tabActivated[activeInfo.tabId] = new Date().getTime();
    _tabActivated(activeInfo.tabId);
    chromelikeNewTabPosition = 0;

    _updateTabIndices();
  });
  chrome.tabs.onDetached.addListener(() => {
    _updateTabIndices();
  });
  chrome.tabs.onAttached.addListener(() => {
    _updateTabIndices();
  });

  function getActiveTab(cb: (tab: any) => void) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
      tabs.length > 0 && cb(tabs[0]);
    });
  }
  chrome.commands.onCommand.addListener((command: string) => {
    switch (command) {
      case "restartext":
        chrome.tabs.query({}, (tabs: any[]) => {
          tabs.forEach((tab) => {
            chrome.tabs.reload(tab.id);
          });
          chrome.runtime.reload();
        });
        break;
      case "previousTab":
      case "nextTab":
        getActiveTab((tab: any) => {
          let index = command === "previousTab" ? tab.index - 1 : tab.index + 1;
          chrome.tabs.query({ windowId: tab.windowId }, (tabs: any[]) => {
            index = ((index % tabs.length) + tabs.length) % tabs.length;
            chrome.tabs.update(tabs[index].id, { active: true });
          });
        });
        break;
      case "closeTab":
        getActiveTab((tab: any) => {
          chrome.tabs.remove(tab.id);
        });
        break;
      default:
        break;
    }
  });

  function _updateTabIndices() {
    if (conf["showTabIndices"]) {
      chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
        tabs.forEach((tab) => {
          sendTabMessage(tab.id, 0, {
            subject: "tabIndexChange",
            index: tab.index + 1,
          });
        });
      });
    }
  }

  function _filterByTitleOrUrl(tabs: any[], query: string) {
    tabs = tabs.filter((b) => {
      return b.url;
    });
    return filterByTitleOrUrl(tabs, query, false);
  }

  function focusTab(windowId: number, tabId: number) {
    chrome.windows.update(
      windowId,
      {
        focused: true,
      },
      () => {
        chrome.tabs.update(tabId, {
          active: true,
        });
      },
    );
  }

  function _nextTab(tab: any, step: number) {
    if (tab) {
      chrome.tabs.query(
        {
          windowId: tab.windowId,
        },
        (tabs: any[]) => {
          if (tab.index == 0 && step == -1) {
            step = tabs.length - 1;
          } else if (tab.index == tabs.length - 1 && step == 1) {
            step = 1 - tabs.length;
          }
          const to = _fixTo(tab.index + step, tabs.length - 1);
          chrome.tabs.update(tabs[to].id, {
            active: true,
          });
        },
      );
    } else {
      getActiveTab((t: any) => {
        _nextTab(t, step);
      });
    }
  }

  function _roundRepeatTabs(tab: any, repeats: number, operation: (tabIds: any[]) => void) {
    if (tab) {
      chrome.tabs.query(
        {
          windowId: tab.windowId,
        },
        (tabs: any[]) => {
          const tabIds = tabs.map((e) => {
            return e.id;
          });
          repeats = _fixTo(repeats, tabs.length);
          const base = _roundBase(tab.index, repeats, tabs.length);
          operation(tabIds.slice(base, base + repeats));
        },
      );
    } else {
      getActiveTab((t: any) => {
        _roundRepeatTabs(t, repeats, operation);
      });
    }
  }

  function _closeTab(s: any, n: number) {
    chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
      const ids = tabs.map((e) => {
        return e.id;
      });
      chrome.tabs.remove(
        ids.slice(s.tab.index + (n < 0 ? n : 1), s.tab.index + (n < 0 ? 0 : 1 + n)),
      );
    });
  }

  function normalizeURL(url: string) {
    if (
      !/^view-source:|^javascript:/.test(url) &&
      /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/\n]+)/im.test(url)
    ) {
      if (!/^[\w-]+?:/i.test(url)) {
        url = "http://" + url;
      }
    }
    return url;
  }

  function openUrlInNewTab(currentTab: any, url: string, message: any) {
    let newTabPosition;
    if (currentTab) {
      switch (conf["newTabPosition"]) {
        case "left":
          newTabPosition = currentTab.index;
          break;
        case "right":
          newTabPosition = currentTab.index + 1;
          break;
        case "first":
          newTabPosition = 0;
          break;
        case "last":
          break;
        default:
          newTabPosition = currentTab.index + 1 + chromelikeNewTabPosition;
          chromelikeNewTabPosition++;
          break;
      }
    }
    chrome.tabs.create(
      {
        url: url,
        active: message.tab.active,
        index: newTabPosition,
        pinned: message.tab.pinned,
        openerTabId: currentTab.id,
      },
      (tab: any) => {
        if (message.scrollLeft || message.scrollTop) {
          tabMessages[tab.id] = {
            scrollLeft: message.scrollLeft,
            scrollTop: message.scrollTop,
          };
        }
      },
    );
  }

  const handlersMap: Record<string, MessageHandler> = {
    getTabs: (message: any, sender: any, sendResponse: any) => {
      const tab = sender.tab;
      const queryInfo = message.queryInfo || {};
      chrome.tabs.query(queryInfo, (tabs: any[]) => {
        tabs = _filterByTitleOrUrl(tabs, message.filter);
        if (tabs.length > message.tabsThreshold && conf["tabsMRUOrder"]) {
          // only remove current tab when tabsMRUOrder is enabled.
          tabs = tabs.filter((b) => {
            return b.id !== tab.id;
          });
          tabs.sort((x, y) => {
            // Shift tabs without "last access" data to the end
            const a = x.lastAccessed || tabActivated[x.id];
            const b = y.lastAccessed || tabActivated[y.id];

            if (!isFinite(a) && !isFinite(b)) {
              return 0;
            }

            if (!isFinite(a)) {
              return 1;
            }

            if (!isFinite(b)) {
              return -1;
            }

            return b - a;
          });
        }
        _response(message, sendResponse, {
          tabs: tabs,
        });
      });
    },
    togglePinTab: (_message: any, _sender: any, _sendResponse: any) => {
      getActiveTab((tab: any) => {
        return chrome.tabs.update(tab.id, {
          pinned: !tab.pinned,
        });
      });
    },
    closeTabByIds: (message: any, _sender: any, _sendResponse: any) => {
      chrome.tabs.remove(message.tabIds);
    },
    focusTab: (message: any, sender: any, _sendResponse: any) => {
      if (message.windowId !== undefined && sender.tab.windowId !== message.windowId) {
        focusTab(message.windowId, message.tabId);
      } else {
        chrome.tabs.update(message.tabId, {
          active: true,
        });
      }
    },
    focusTabByIndex: (message: any, _sender: any, _sendResponse: any) => {
      const queryInfo = message.queryInfo || { currentWindow: true };
      chrome.tabs.query(queryInfo, (tabs: any[]) => {
        if (message.repeats > 0 && message.repeats <= tabs.length) {
          chrome.tabs.update(tabs[message.repeats - 1].id, {
            active: true,
          });
        }
      });
    },
    goToLastTab: (_message: any, _sender: any, _sendResponse: any) => {
      const lastTab = tabHistory.previousTab();
      if (lastTab !== undefined) {
        chrome.tabs.update(lastTab, {
          active: true,
        });
      }
    },
    historyTab: (message: any, _sender?: any, _sendResponse?: any) => {
      const tabId = tabHistory.navigate(message);
      if (tabId !== undefined) {
        chrome.tabs.update(tabId, {
          active: true,
        });
      }
    },
    nextTab: (message: any, sender: any, _sendResponse: any) => {
      _nextTab(sender.tab, message.repeats);
    },
    previousTab: (message: any, sender: any, _sendResponse: any) => {
      _nextTab(sender.tab, -message.repeats);
    },
    reloadTab: (message: any, sender: any, _sendResponse: any) => {
      _roundRepeatTabs(sender.tab, message.repeats, (tabIds) => {
        tabIds.forEach((tabId) => {
          chrome.tabs.reload(tabId, {
            bypassCache: message.nocache,
          });
        });
      });
    },
    closeTab: (message: any, sender: any, _sendResponse: any) => {
      _roundRepeatTabs(sender.tab, message.repeats, (tabIds) => {
        chrome.tabs.remove(tabIds, () => {
          if (conf["focusAfterClosed"] === "left") {
            _nextTab(sender.tab, -1);
          } else if (conf["focusAfterClosed"] === "last") {
            const historyTab = handlers["historyTab"];
            if (historyTab) {
              historyTab({ backward: true });
            }
          }
        });
      });
    },
    closeTabLeft: (message: any, sender: any, _senderResponse: any) => {
      _closeTab(sender, -message.repeats);
    },
    closeTabRight: (message: any, sender: any, _senderResponse: any) => {
      _closeTab(sender, message.repeats);
    },
    closeTabsToLeft: (_message: any, sender: any, _senderResponse: any) => {
      _closeTab(sender, -sender.tab.index);
    },
    closeTabsToRight: (_message: any, sender: any, _senderResponse: any) => {
      chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
        _closeTab(sender, tabs.length - sender.tab.index);
      });
    },
    tabOnly: (_message: any, sender: any, _sendResponse: any) => {
      chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
        const ids = tabs
          .filter((t) => {
            return t.id != sender.tab.id && !t.pinned;
          })
          .map((t) => {
            return t.id;
          });
        chrome.tabs.remove(ids);
      });
    },
    closeAudibleTab: (_message: any, _sender: any, _sendResponse: any) => {
      chrome.tabs.query({ audible: true }, (tabs: any[]) => {
        if (tabs) {
          chrome.tabs.remove(tabs[0].id);
        }
      });
    },
    muteTab: (_message: any, sender: any, _sendResponse: any) => {
      const tab = sender.tab;
      chrome.tabs.update(tab.id, {
        muted: !tab.mutedInfo.muted,
      });
    },
    openLast: (_message: any, _sender: any, _sendResponse: any) => {
      chrome.sessions.restore();
    },
    duplicateTab: (message: any, sender: any, _sendResponse: any) => {
      chrome.tabs.duplicate(sender.tab.id, () => {
        if (message.active === false) {
          chrome.tabs.update(sender.tab.id, { active: true });
        }
      });
    },
    getWindows: (message: any, _sender: any, sendResponse: any) => {
      chrome.tabs.query({ currentWindow: false }, (tabs: any[]) => {
        const windows: Record<string, any> = {};
        tabs.forEach((t) => {
          const tabsInWindow = windows[t.windowId] || [];
          tabsInWindow.push({ title: t.title, url: t.url });
          windows[t.windowId] = tabsInWindow;
        });
        _response(message, sendResponse, {
          windows: Object.keys(windows).map((w) => {
            return {
              id: w,
              tabs: windows[w],
              isPreviousChoice: parseInt(w) === previousWindowChoice,
            };
          }),
        });
      });
    },
    moveToWindow: (message: any, sender: any, _sendResponse: any) => {
      if (message.windowId === -1) {
        chrome.windows.create({ tabId: sender.tab.id });
      } else {
        chrome.tabs.move(sender.tab.id, { windowId: message.windowId, index: -1 }, () => {
          focusTab(message.windowId, sender.tab.id);
        });
      }
      previousWindowChoice = message.windowId;
    },
    gatherWindows: (_message: any, sender: any, _sendResponse: any) => {
      const windowId = sender.tab.windowId;
      chrome.tabs.query({ currentWindow: false }, (tabs: any[]) => {
        tabs.forEach((tab) => {
          chrome.tabs.move(tab.id, { windowId, index: -1 });
        });
      });
    },
    gatherTabs: (message: any, sender: any, _sendResponse: any) => {
      const windowId = sender.tab.windowId;
      message.tabs.forEach((tab: any) => {
        chrome.tabs.move(tab.id, { windowId, index: -1 });
      });
    },
    openLink: (message: any, sender: any, _sendResponse: any) => {
      const url = normalizeURL(message.url);
      if (url.startsWith("javascript:")) {
        sendTabMessage(sender.tab.id, 0, {
          subject: "showBanner",
          message: "JavaScript URLs are not allowed in such operation.",
        });
      } else {
        if (message.tab.tabbed) {
          if (
            (sender.frameId !== 0 && chrome.runtime.getURL("frontend.html") === sender.url) ||
            !sender.tab
          ) {
            // if current call was made from Omnibar, the sender.tab may be stale,
            // as sender was bound when port was created.
            getActiveTab((tab: any) => {
              openUrlInNewTab(tab, url, message);
            });
          } else {
            openUrlInNewTab(sender.tab, url, message);
          }
        } else {
          chrome.tabs.update(
            {
              url: url,
              pinned: message.tab.pinned || sender.tab.pinned,
            },
            (tab: any) => {
              if (message.scrollLeft || message.scrollTop) {
                tabMessages[tab.id] = {
                  scrollLeft: message.scrollLeft,
                  scrollTop: message.scrollTop,
                };
              }
            },
          );
        }
      }
    },
    viewSource: (message: any, sender: any, sendResponse: any) => {
      message.url = "view-source:" + sender.tab.url;
      const openLink = handlers["openLink"];
      if (openLink) {
        openLink(message, sender, sendResponse);
      }
    },
    nextFrame: (message: any, sender: any, _sendResponse: any) => {
      const tid = sender.tab.id;
      chrome.scripting.executeScript(
        {
          target: {
            allFrames: true,
            tabId: tid,
          },
          func: () => {
            return typeof (window as any).getFrameId === "function"
              ? (window as any).getFrameId()
              : 0;
          },
        },
        (framesInTab: any[]) => {
          framesInTab = framesInTab
            .map((res) => {
              return res.result;
            })
            .filter((frameId) => {
              return frameId;
            });

          if (framesInTab.length > 0) {
            let i = 0;
            for (i = 0; i < framesInTab.length; i++) {
              if (framesInTab[i] === message.frameId) {
                break;
              }
            }
            i = i === framesInTab.length - 1 ? 0 : i + 1;
            sendTabMessage(tid, -1, {
              subject: "focusFrame",
              frameId: framesInTab[i],
            });
          }
        },
      );
    },
    moveTab: (message: any, sender: any, _sendResponse: any) => {
      chrome.tabs.query(
        {
          windowId: sender.tab.windowId,
        },
        (tabs: any[]) => {
          const to = _fixTo(sender.tab.index + message.step * message.repeats, tabs.length);
          chrome.tabs.move(sender.tab.id, {
            index: to,
          });
        },
      );
    },
    tabURLAccessed: (message: any, sender: any, _sendResponse: any) => {
      if (sender.tab) {
        const tabId = sender.tab.id;
        _setScrollPos_bg(tabId);
        if (!Object.prototype.hasOwnProperty.call(tabURLs, tabId)) {
          tabURLs[tabId] = {};
        }
        tabURLs[tabId][message.url] = message.title;
        return {
          active: sender.tab.active,
          index: conf["showTabIndices"] ? sender.tab.index + 1 : 0,
        };
      } else {
        return {};
      }
    },
    getTabURLs: (_message: any, sender: any, _sendResponse: any) => {
      const tabURL = tabURLs[sender.tab.id] || {};
      const urls = Object.keys(tabURL).map((u) => {
        return {
          url: u,
          title: tabURL[u],
        };
      });
      return {
        urls: urls,
      };
    },
    getTopURL: (_message: any, sender: any, _sendResponse: any) => {
      return {
        url: sender.tab ? sender.tab.url : "",
      };
    },
    setZoom: (message: any, sender: any, _sendResponse: any) => {
      const tabId = sender.tab.id;
      const zoomFactor = message.zoomFactor * message.repeats;
      if (zoomFactor == 0) {
        chrome.tabs.getZoomSettings(tabId, (settings: any) => {
          const defaultZoom = settings.defaultZoomFactor ? settings.defaultZoomFactor : 1;
          chrome.tabs.setZoom(tabId, defaultZoom);
        });
      } else {
        chrome.tabs.getZoom(tabId, (zf: number) => {
          chrome.tabs.setZoom(tabId, zf + zoomFactor);
        });
      }
    },
    queueURLs: (message: any, _sender: any, _sendResponse: any) => {
      _queueURLs = _queueURLs.concat(message.urls);
    },
    getQueueURLs: (_message: any, _sender: any, _sendResponse: any) => {
      return {
        queueURLs: _queueURLs,
      };
    },
    clearQueueURLs: (_message: any, _sender: any, _sendResponse: any) => {
      _queueURLs = [];
    },
  };

  return {
    handlers: handlersMap,
    sendTabMessage,
    filterByTitleOrUrl: _filterByTitleOrUrl,
    tabMessages,
    setScrollPos: _setScrollPos_bg,
    newTabUrl,
  };
}
