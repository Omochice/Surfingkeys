import { Result } from "@praha/byethrow";

import { chromeRuntimeError } from "../common/result";
import { filterByTitleOrUrl } from "../common/utils";
import type { MessageHandler } from "./start";
import { createTabHistory } from "./tabHistory";

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
 * Dependencies the tab core takes from the composition root: the shared mutable `conf` (written by
 * settings, read here), the per-browser glue, and the shared `handlers` registry for the two
 * intra-tab cross-calls (viewSource → openLink, closeTab → historyTab).
 */
export type TabsDeps = {
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
  filterByTitleOrUrl: (tabs: readonly any[], query: string) => readonly any[];
  tabMessages: Record<string, any>;
  setScrollPos: (tabId: number) => void;
  newTabUrl: string;
};

/**
 * Tab and window core: the MRU/index/url bookkeeping maps and the tab lifecycle listeners, the
 * navigation/close/move helpers, and every tab- and window-oriented message handler. Owns the
 * queued-URL list because the onRemoved handler drains it. Reads the shared `conf` by reference and
 * reaches the rest of the registry through the injected `handlers` for two cross-calls. Handlers
 * resolve to their response payload; the dispatcher in `start` settles the sender.
 */
export function createTabs(deps: TabsDeps): TabsUnit {
  const { conf, browser, handlers } = deps;

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

    void _updateTabIndices();
  }
  chrome.tabs.onRemoved.addListener(removeTab);
  function _setScrollPos_bg(tabId: number) {
    if (Object.hasOwn(tabMessages, tabId)) {
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
    // Wrap to suppress Uncaught (in promise) Error on sending message to unsupported tabs like chrome://
    const p = chrome.tabs.sendMessage(tabId, message, opts);
    if (p) {
      void Result.try({
        try: () => p,
        catch: (cause) => chromeRuntimeError("sendTabMessage", cause),
      });
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
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) {
      _tabActivated(tabId);
    }
    if (browser.detectTabTitleChange && changeInfo.title) {
      sendTabMessage(tabId, 0, {
        subject: "titleChanged",
        changeInfo,
      });
    }
  });
  chrome.windows.onFocusChanged.addListener(async () => {
    const tab = await getActiveTab();
    if (tab) {
      _tabActivated(tab.id!);
    }
  });

  chrome.tabs.onCreated.addListener(() => {
    void _updateTabIndices();
  });
  chrome.tabs.onMoved.addListener(() => {
    void _updateTabIndices();
  });
  chrome.tabs.onActivated.addListener((activeInfo) => {
    tabHistory.record(activeInfo.tabId);
    tabActivated[activeInfo.tabId] = Date.now();
    _tabActivated(activeInfo.tabId);
    chromelikeNewTabPosition = 0;

    void _updateTabIndices();
  });
  chrome.tabs.onDetached.addListener(() => {
    void _updateTabIndices();
  });
  chrome.tabs.onAttached.addListener(() => {
    void _updateTabIndices();
  });

  async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs.length > 0 ? tabs[0] : undefined;
  }
  chrome.commands.onCommand.addListener(async (command: string) => {
    switch (command) {
      case "restartext": {
        const tabs = await chrome.tabs.query({});
        tabs.forEach((tab) => {
          chrome.tabs.reload(tab.id!);
        });
        chrome.runtime.reload();
        break;
      }
      case "previousTab":
      case "nextTab": {
        const tab = await getActiveTab();
        if (!tab) {
          break;
        }
        let index = command === "previousTab" ? tab.index - 1 : tab.index + 1;
        const tabs = await chrome.tabs.query({ windowId: tab.windowId });
        index = ((index % tabs.length) + tabs.length) % tabs.length;
        chrome.tabs.update(tabs[index]!.id!, { active: true });
        break;
      }
      case "closeTab": {
        const tab = await getActiveTab();
        if (tab) {
          chrome.tabs.remove(tab.id!);
        }
        break;
      }
      default: {
        break;
      }
    }
  });

  async function _updateTabIndices() {
    if (conf["showTabIndices"]) {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      tabs.forEach((tab) => {
        sendTabMessage(tab.id!, 0, {
          subject: "tabIndexChange",
          index: tab.index + 1,
        });
      });
    }
  }

  function _filterByTitleOrUrl(tabs: readonly any[], query: string) {
    tabs = tabs.filter((b) => {
      return b.url;
    });
    return filterByTitleOrUrl(tabs, query, false);
  }

  async function focusTab(windowId: number, tabId: number) {
    await chrome.windows.update(windowId, {
      focused: true,
    });
    await chrome.tabs.update(tabId, {
      active: true,
    });
  }

  async function _nextTab(tab: any, step: number): Promise<void> {
    if (tab) {
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      if (tab.index == 0 && step == -1) {
        step = tabs.length - 1;
      } else if (tab.index == tabs.length - 1 && step == 1) {
        step = 1 - tabs.length;
      }
      const to = _fixTo(tab.index + step, tabs.length - 1);
      await chrome.tabs.update(tabs[to]!.id!, {
        active: true,
      });
    } else {
      await _nextTab(await getActiveTab(), step);
    }
  }

  async function _roundRepeatTabs(
    tab: any,
    repeats: number,
    operation: (tabIds: number[]) => void | Promise<void>,
  ): Promise<void> {
    if (tab) {
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      const tabIds = tabs.map((e) => {
        return e.id!;
      });
      repeats = _fixTo(repeats, tabs.length);
      const base = _roundBase(tab.index, repeats, tabs.length);
      await operation(tabIds.slice(base, base + repeats));
    } else {
      await _roundRepeatTabs(await getActiveTab(), repeats, operation);
    }
  }

  async function _closeTab(s: any, n: number) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const ids = tabs.map((e) => {
      return e.id!;
    });
    chrome.tabs.remove(ids.slice(s.tab.index + (n < 0 ? n : 1), s.tab.index + (n < 0 ? 0 : 1 + n)));
  }

  function normalizeURL(url: string) {
    if (
      !/^view-source:|^javascript:/.test(url) &&
      /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/\n]+)/im.test(url) &&
      !/^[\w-]+?:/i.test(url)
    ) {
      url = "http://" + url;
    }
    return url;
  }

  async function openUrlInNewTab(currentTab: any, url: string, message: any) {
    let newTabPosition;
    if (currentTab) {
      switch (conf["newTabPosition"]) {
        case "left": {
          newTabPosition = currentTab.index;
          break;
        }
        case "right": {
          newTabPosition = currentTab.index + 1;
          break;
        }
        case "first": {
          newTabPosition = 0;
          break;
        }
        case "last": {
          break;
        }
        default: {
          newTabPosition = currentTab.index + 1 + chromelikeNewTabPosition;
          chromelikeNewTabPosition++;
          break;
        }
      }
    }
    const tab = await chrome.tabs.create({
      url: url,
      active: message.tab.active,
      index: newTabPosition,
      pinned: message.tab.pinned,
      openerTabId: currentTab.id,
    });
    if (message.scrollLeft || message.scrollTop) {
      tabMessages[tab.id!] = {
        scrollLeft: message.scrollLeft,
        scrollTop: message.scrollTop,
      };
    }
  }

  const handlersMap: Record<string, MessageHandler> = {
    getTabs: async (message: any, sender: any) => {
      const tab = sender.tab;
      const queryInfo = message.queryInfo || {};
      let tabs: readonly chrome.tabs.Tab[] = await chrome.tabs.query(queryInfo);
      tabs = _filterByTitleOrUrl(tabs, message.filter);
      if (tabs.length > message.tabsThreshold && conf["tabsMRUOrder"]) {
        // only remove current tab when tabsMRUOrder is enabled.
        tabs = tabs.filter((b) => {
          return b.id !== tab.id;
        });
        tabs = tabs.toSorted((x, y) => {
          // Shift tabs without "last access" data to the end
          const a = x.lastAccessed || tabActivated[x.id!];
          const b = y.lastAccessed || tabActivated[y.id!];

          if (!Number.isFinite(a) && !Number.isFinite(b)) {
            return 0;
          }

          if (!Number.isFinite(a)) {
            return 1;
          }

          if (!Number.isFinite(b)) {
            return -1;
          }

          return b - a;
        });
      }
      return { tabs };
    },
    togglePinTab: async () => {
      const tab = await getActiveTab();
      if (tab) {
        await chrome.tabs.update(tab.id!, {
          pinned: !tab.pinned,
        });
      }
    },
    closeTabByIds: (message: any) => {
      chrome.tabs.remove(message.tabIds);
    },
    focusTab: (message: any, sender: any) => {
      if (message.windowId != null && sender.tab.windowId !== message.windowId) {
        return focusTab(message.windowId, message.tabId);
      }
      return chrome.tabs.update(message.tabId, {
        active: true,
      });
    },
    focusTabByIndex: async (message: any) => {
      const queryInfo = message.queryInfo || { currentWindow: true };
      const tabs = await chrome.tabs.query(queryInfo);
      if (message.repeats > 0 && message.repeats <= tabs.length) {
        await chrome.tabs.update(tabs[message.repeats - 1]!.id!, {
          active: true,
        });
      }
    },
    goToLastTab: () => {
      const lastTab = tabHistory.previousTab();
      if (lastTab != null) {
        chrome.tabs.update(lastTab, {
          active: true,
        });
      }
    },
    historyTab: (message: any) => {
      const tabId = tabHistory.navigate(message);
      if (tabId != null) {
        chrome.tabs.update(tabId, {
          active: true,
        });
      }
    },
    nextTab: (message: any, sender: any) => _nextTab(sender.tab, message.repeats),
    previousTab: (message: any, sender: any) => _nextTab(sender.tab, -message.repeats),
    reloadTab: (message: any, sender: any) =>
      _roundRepeatTabs(sender.tab, message.repeats, (tabIds) => {
        tabIds.forEach((tabId) => {
          chrome.tabs.reload(tabId, {
            bypassCache: message.nocache,
          });
        });
      }),
    closeTab: (message: any, sender: any) =>
      _roundRepeatTabs(sender.tab, message.repeats, async (tabIds) => {
        await chrome.tabs.remove(tabIds);
        if (conf["focusAfterClosed"] === "left") {
          await _nextTab(sender.tab, -1);
        } else if (conf["focusAfterClosed"] === "last") {
          const historyTab = handlers["historyTab"];
          if (historyTab) {
            historyTab({ backward: true });
          }
        }
      }),
    closeTabLeft: (message: any, sender: any) => _closeTab(sender, -message.repeats),
    closeTabRight: (message: any, sender: any) => _closeTab(sender, message.repeats),
    closeTabsToLeft: (_message: any, sender: any) => _closeTab(sender, -sender.tab.index),
    closeTabsToRight: async (_message: any, sender: any) => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      await _closeTab(sender, tabs.length - sender.tab.index);
    },
    tabOnly: async (_message: any, sender: any) => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const ids = tabs
        .filter((t) => {
          return t.id != sender.tab.id && !t.pinned;
        })
        .map((t) => {
          return t.id!;
        });
      chrome.tabs.remove(ids);
    },
    closeAudibleTab: async () => {
      const tabs = await chrome.tabs.query({ audible: true });
      if (tabs) {
        chrome.tabs.remove(tabs[0]!.id!);
      }
    },
    muteTab: (_message: any, sender: any) => {
      const tab = sender.tab;
      chrome.tabs.update(tab.id, {
        muted: !tab.mutedInfo.muted,
      });
    },
    openLast: () => {
      chrome.sessions.restore();
    },
    duplicateTab: async (message: any, sender: any) => {
      await chrome.tabs.duplicate(sender.tab.id);
      if (message.active === false) {
        await chrome.tabs.update(sender.tab.id, { active: true });
      }
    },
    getWindows: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: false });
      const windows: Record<string, any> = {};
      tabs.forEach((t) => {
        const tabsInWindow = windows[t.windowId] || [];
        tabsInWindow.push({ title: t.title, url: t.url });
        windows[t.windowId] = tabsInWindow;
      });
      return {
        windows: Object.keys(windows).map((w) => {
          return {
            id: w,
            tabs: windows[w],
            isPreviousChoice: Number.parseInt(w) === previousWindowChoice,
          };
        }),
      };
    },
    moveToWindow: async (message: any, sender: any) => {
      if (message.windowId === -1) {
        chrome.windows.create({ tabId: sender.tab.id });
      } else {
        await chrome.tabs.move(sender.tab.id, { windowId: message.windowId, index: -1 });
        await focusTab(message.windowId, sender.tab.id);
      }
      previousWindowChoice = message.windowId;
    },
    gatherWindows: async (_message: any, sender: any) => {
      const windowId = sender.tab.windowId;
      const tabs = await chrome.tabs.query({ currentWindow: false });
      tabs.forEach((tab) => {
        chrome.tabs.move(tab.id!, { windowId, index: -1 });
      });
    },
    gatherTabs: (message: any, sender: any) => {
      const windowId = sender.tab.windowId;
      message.tabs.forEach((tab: any) => {
        chrome.tabs.move(tab.id, { windowId, index: -1 });
      });
    },
    openLink: async (message: any, sender: any) => {
      const url = normalizeURL(message.url);
      if (url.startsWith("javascript:")) {
        sendTabMessage(sender.tab.id, 0, {
          subject: "showBanner",
          message: "JavaScript URLs are not allowed in such operation.",
        });
        return;
      }
      if (message.tab.tabbed) {
        if (
          (sender.frameId !== 0 && chrome.runtime.getURL("frontend.html") === sender.url) ||
          !sender.tab
        ) {
          // if current call was made from Omnibar, the sender.tab may be stale,
          // as sender was bound when port was created.
          await openUrlInNewTab(await getActiveTab(), url, message);
        } else {
          await openUrlInNewTab(sender.tab, url, message);
        }
      } else {
        const tab = await chrome.tabs.update({
          url: url,
          pinned: message.tab.pinned || sender.tab.pinned,
        });
        if (message.scrollLeft || message.scrollTop) {
          tabMessages[tab!.id!] = {
            scrollLeft: message.scrollLeft,
            scrollTop: message.scrollTop,
          };
        }
      }
    },
    viewSource: (message: any, sender: any, sendResponse: any) => {
      message.url = "view-source:" + sender.tab.url;
      const openLink = handlers["openLink"];
      if (openLink) {
        return openLink(message, sender, sendResponse);
      }
      return undefined;
    },
    nextFrame: async (message: any, sender: any) => {
      const tid = sender.tab.id;
      const results = await chrome.scripting.executeScript({
        target: {
          allFrames: true,
          tabId: tid,
        },
        func: () => {
          return typeof window.getFrameId === "function" ? window.getFrameId() : 0;
        },
      });
      const framesInTab = results
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
    moveTab: async (message: any, sender: any) => {
      const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
      const to = _fixTo(sender.tab.index + message.step * message.repeats, tabs.length);
      chrome.tabs.move(sender.tab.id, {
        index: to,
      });
    },
    tabURLAccessed: (message: any, sender: any) => {
      if (sender.tab) {
        const tabId = sender.tab.id;
        _setScrollPos_bg(tabId);
        if (!Object.hasOwn(tabURLs, tabId)) {
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
    getTabURLs: (_message: any, sender: any) => {
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
    getTopURL: (_message: any, sender: any) => {
      return {
        url: sender.tab ? sender.tab.url : "",
      };
    },
    setZoom: async (message: any, sender: any) => {
      const tabId = sender.tab.id;
      const zoomFactor = message.zoomFactor * message.repeats;
      if (zoomFactor == 0) {
        const settings = await chrome.tabs.getZoomSettings(tabId);
        const defaultZoom = settings.defaultZoomFactor || 1;
        await chrome.tabs.setZoom(tabId, defaultZoom);
      } else {
        const zf = await chrome.tabs.getZoom(tabId);
        await chrome.tabs.setZoom(tabId, zf + zoomFactor);
      }
    },
    queueURLs: (message: any) => {
      _queueURLs = _queueURLs.concat(message.urls);
    },
    getQueueURLs: () => {
      return {
        queueURLs: _queueURLs,
      };
    },
    clearQueueURLs: () => {
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
