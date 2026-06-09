import { Result } from "@praha/byethrow";
import * as v from "valibot";

import { chromeRuntimeError } from "../common/result";
import { filterByTitleOrUrl } from "../common/utils";
import type { BackgroundConf, BrowserAdapter, MessageHandler } from "./start";
import { createTabHistory } from "./tabHistory";

// Repeat-count actions carry `repeats` (injected by the content-script RUNTIME
// helper); validate it rather than trusting the cross-process payload.
const repeatsSchema = v.object({ repeats: v.optional(v.number()) });
const reloadTabSchema = v.object({
  repeats: v.optional(v.number()),
  nocache: v.optional(v.boolean()),
});
const closeTabByIdsSchema = v.object({ tabIds: v.union([v.number(), v.array(v.number())]) });
const focusTabSchema = v.object({ windowId: v.optional(v.number()), tabId: v.number() });
const duplicateTabSchema = v.object({ active: v.optional(v.boolean()) });
const windowIdSchema = v.object({ windowId: v.number() });
const gatherTabsSchema = v.object({ tabs: v.array(v.object({ id: v.number() })) });
const moveTabSchema = v.object({ step: v.number(), repeats: v.optional(v.number()) });
const tabURLAccessedSchema = v.object({ url: v.string(), title: v.string() });
const setZoomSchema = v.object({ zoomFactor: v.number(), repeats: v.optional(v.number()) });
const queueURLsSchema = v.object({ urls: v.array(v.string()) });
const historyTabSchema = v.object({
  index: v.optional(v.unknown()),
  backward: v.optional(v.boolean()),
});
const nextFrameSchema = v.object({ frameId: v.optional(v.union([v.string(), v.number()])) });
const tabFlagsSchema = v.object({
  tabbed: v.optional(v.boolean()),
  active: v.optional(v.boolean()),
  pinned: v.optional(v.boolean()),
});
const openLinkSchema = v.object({
  url: v.string(),
  tab: tabFlagsSchema,
  scrollLeft: v.optional(v.number()),
  scrollTop: v.optional(v.number()),
});
const viewSourceSchema = v.object({
  tab: tabFlagsSchema,
  scrollLeft: v.optional(v.number()),
  scrollTop: v.optional(v.number()),
});
type OpenLinkMessage = v.InferOutput<typeof openLinkSchema>;
// Mirrors chrome.tabs.QueryInfo so a validated payload is a structurally valid
// argument to chrome.tabs.query; the enum-typed fields use picklists.
const queryInfoSchema = v.optional(
  v.object({
    active: v.optional(v.boolean()),
    audible: v.optional(v.boolean()),
    autoDiscardable: v.optional(v.boolean()),
    currentWindow: v.optional(v.boolean()),
    discarded: v.optional(v.boolean()),
    groupId: v.optional(v.number()),
    highlighted: v.optional(v.boolean()),
    index: v.optional(v.number()),
    lastFocusedWindow: v.optional(v.boolean()),
    muted: v.optional(v.boolean()),
    pinned: v.optional(v.boolean()),
    status: v.optional(v.picklist(["unloaded", "loading", "complete"])),
    title: v.optional(v.string()),
    url: v.optional(v.union([v.string(), v.array(v.string())])),
    windowId: v.optional(v.number()),
    windowType: v.optional(v.picklist(["normal", "popup", "panel", "app", "devtools"])),
  }),
);
const getTabsSchema = v.object({
  queryInfo: queryInfoSchema,
  filter: v.optional(v.string()),
  tabsThreshold: v.optional(v.number()),
});
const focusTabByIndexSchema = v.object({
  queryInfo: queryInfoSchema,
  repeats: v.optional(v.number()),
});

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
  conf: BackgroundConf;
  browser: Pick<BrowserAdapter, "_setNewTabUrl"> &
    Partial<Pick<BrowserAdapter, "detectTabTitleChange">>;
  handlers: Record<string, MessageHandler>;
};

/**
 * What the composition root needs back from the tab core: the handler map to register, plus the
 * primitives other units depend on — `sendTabMessage` and `tabMessages`/`setScrollPos`/`newTabUrl`
 * injected into settings, and `filterByTitleOrUrl` injected into the history unit.
 */
export type TabsUnit = {
  handlers: Record<string, MessageHandler>;
  sendTabMessage: (tabId: number, frameId: number, message: unknown) => void;
  filterByTitleOrUrl: <T extends { title?: string | undefined; url?: string | undefined }>(
    tabs: readonly T[],
    query: string,
  ) => readonly T[];
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
  const tabActivated: Record<number, number> = {};
  const tabMessages: Record<string, any> = {};
  const tabURLs: Record<number, Record<string, string>> = {};

  const newTabUrl = browser._setNewTabUrl();

  let _lastActiveTabId: number | null = null;
  let previousWindowChoice = -1;
  let _queueURLs: string[] = [];

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

  function sendTabMessage(tabId: number, frameId: number, message: unknown) {
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

  function _filterByTitleOrUrl<T extends { title?: string | undefined; url?: string | undefined }>(
    tabs: readonly T[],
    query: string,
  ): readonly T[] {
    return filterByTitleOrUrl(
      tabs.filter((b) => {
        return b.url;
      }),
      query,
      false,
    );
  }

  async function focusTab(windowId: number, tabId: number) {
    await chrome.windows.update(windowId, {
      focused: true,
    });
    await chrome.tabs.update(tabId, {
      active: true,
    });
  }

  async function _nextTab(tab: chrome.tabs.Tab | undefined, step: number): Promise<void> {
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
    tab: chrome.tabs.Tab | undefined,
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

  async function _closeTab(s: chrome.runtime.MessageSender, n: number) {
    if (!s.tab) {
      return;
    }
    const tabIndex = s.tab.index;
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const ids = tabs.map((e) => {
      return e.id!;
    });
    chrome.tabs.remove(ids.slice(tabIndex + (n < 0 ? n : 1), tabIndex + (n < 0 ? 0 : 1 + n)));
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

  async function openUrlInNewTab(
    currentTab: chrome.tabs.Tab | undefined,
    url: string,
    message: OpenLinkMessage,
  ) {
    let newTabPosition: number | undefined;
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
      openerTabId: currentTab?.id,
    });
    if ((message.scrollLeft || message.scrollTop) && tab.id != null) {
      tabMessages[tab.id] = {
        scrollLeft: message.scrollLeft,
        scrollTop: message.scrollTop,
      };
    }
  }

  const handlersMap: Record<string, MessageHandler> = {
    getTabs: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const senderTabId = sender?.tab?.id;
      const { queryInfo, filter, tabsThreshold } = v.parse(getTabsSchema, message);
      let tabs: readonly chrome.tabs.Tab[] = await chrome.tabs.query(queryInfo ?? {});
      tabs = _filterByTitleOrUrl(tabs, filter ?? "");
      if (tabsThreshold != null && tabs.length > tabsThreshold && conf["tabsMRUOrder"]) {
        // only remove current tab when tabsMRUOrder is enabled.
        tabs = tabs.filter((b) => {
          return b.id !== senderTabId;
        });
        tabs = tabs.toSorted((x, y) => {
          // Shift tabs without "last access" data to the end
          const a = x.lastAccessed ?? tabActivated[x.id ?? -1];
          const b = y.lastAccessed ?? tabActivated[y.id ?? -1];

          if (!Number.isFinite(a) && !Number.isFinite(b)) {
            return 0;
          }

          if (!Number.isFinite(a)) {
            return 1;
          }

          if (!Number.isFinite(b)) {
            return -1;
          }

          return (b ?? 0) - (a ?? 0);
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
    closeTabByIds: (message: unknown) => {
      const { tabIds } = v.parse(closeTabByIdsSchema, message);
      chrome.tabs.remove(Array.isArray(tabIds) ? tabIds : [tabIds]);
    },
    focusTab: (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const { windowId, tabId } = v.parse(focusTabSchema, message);
      if (windowId != null && sender?.tab?.windowId !== windowId) {
        return focusTab(windowId, tabId);
      }
      return chrome.tabs.update(tabId, {
        active: true,
      });
    },
    focusTabByIndex: async (message: unknown) => {
      const { queryInfo, repeats } = v.parse(focusTabByIndexSchema, message);
      const tabs = await chrome.tabs.query(queryInfo ?? { currentWindow: true });
      if (repeats != null && repeats > 0 && repeats <= tabs.length) {
        const target = tabs[repeats - 1];
        if (target?.id != null) {
          await chrome.tabs.update(target.id, {
            active: true,
          });
        }
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
    historyTab: (message: unknown) => {
      const tabId = tabHistory.navigate(v.parse(historyTabSchema, message));
      if (tabId != null) {
        chrome.tabs.update(tabId, {
          active: true,
        });
      }
    },
    nextTab: (message: unknown, sender?: chrome.runtime.MessageSender) =>
      _nextTab(sender?.tab, v.parse(repeatsSchema, message).repeats ?? 1),
    previousTab: (message: unknown, sender?: chrome.runtime.MessageSender) =>
      _nextTab(sender?.tab, -(v.parse(repeatsSchema, message).repeats ?? 1)),
    reloadTab: (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const { repeats, nocache } = v.parse(reloadTabSchema, message);
      return _roundRepeatTabs(sender?.tab, repeats ?? 1, (tabIds) => {
        tabIds.forEach((tabId) => {
          chrome.tabs.reload(tabId, {
            bypassCache: nocache,
          });
        });
      });
    },
    closeTab: (message: unknown, sender?: chrome.runtime.MessageSender) =>
      _roundRepeatTabs(
        sender?.tab,
        v.parse(repeatsSchema, message).repeats ?? 1,
        async (tabIds) => {
          await chrome.tabs.remove(tabIds);
          if (conf["focusAfterClosed"] === "left") {
            await _nextTab(sender?.tab, -1);
          } else if (conf["focusAfterClosed"] === "last") {
            const historyTab = handlers["historyTab"];
            if (historyTab) {
              historyTab({ backward: true });
            }
          }
        },
      ),
    closeTabLeft: (message: unknown, sender?: chrome.runtime.MessageSender) =>
      sender ? _closeTab(sender, -(v.parse(repeatsSchema, message).repeats ?? 1)) : undefined,
    closeTabRight: (message: unknown, sender?: chrome.runtime.MessageSender) =>
      sender ? _closeTab(sender, v.parse(repeatsSchema, message).repeats ?? 1) : undefined,
    closeTabsToLeft: (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      if (!sender?.tab) {
        return undefined;
      }
      return _closeTab(sender, -sender.tab.index);
    },
    closeTabsToRight: async (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      if (!sender?.tab) {
        return;
      }
      const tabs = await chrome.tabs.query({ currentWindow: true });
      await _closeTab(sender, tabs.length - sender.tab.index);
    },
    tabOnly: async (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      const senderTabId = sender?.tab?.id;
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const ids = tabs
        .filter((t) => {
          return t.id != senderTabId && !t.pinned;
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
    muteTab: (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      const tab = sender?.tab;
      if (tab?.id == null) {
        return;
      }
      chrome.tabs.update(tab.id, {
        muted: !tab.mutedInfo?.muted,
      });
    },
    openLast: () => {
      chrome.sessions.restore();
    },
    duplicateTab: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const tabId = sender?.tab?.id;
      if (tabId == null) {
        return;
      }
      await chrome.tabs.duplicate(tabId);
      if (v.parse(duplicateTabSchema, message).active === false) {
        await chrome.tabs.update(tabId, { active: true });
      }
    },
    getWindows: async () => {
      const tabs = await chrome.tabs.query({ currentWindow: false });
      const windows: Record<string, { title?: string | undefined; url?: string | undefined }[]> =
        {};
      tabs.forEach((t) => {
        const tabsInWindow = windows[t.windowId] ?? [];
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
    moveToWindow: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const { windowId } = v.parse(windowIdSchema, message);
      const tabId = sender?.tab?.id;
      if (tabId == null) {
        return;
      }
      if (windowId === -1) {
        chrome.windows.create({ tabId });
      } else {
        await chrome.tabs.move(tabId, { windowId, index: -1 });
        await focusTab(windowId, tabId);
      }
      previousWindowChoice = windowId;
    },
    gatherWindows: async (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      const windowId = sender?.tab?.windowId;
      if (windowId == null) {
        return;
      }
      const tabs = await chrome.tabs.query({ currentWindow: false });
      tabs.forEach((tab) => {
        chrome.tabs.move(tab.id!, { windowId, index: -1 });
      });
    },
    gatherTabs: (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const windowId = sender?.tab?.windowId;
      if (windowId == null) {
        return;
      }
      v.parse(gatherTabsSchema, message).tabs.forEach((tab) => {
        chrome.tabs.move(tab.id, { windowId, index: -1 });
      });
    },
    openLink: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const parsed = v.parse(openLinkSchema, message);
      const url = normalizeURL(parsed.url);
      if (url.startsWith("javascript:")) {
        if (sender?.tab?.id != null) {
          sendTabMessage(sender.tab.id, 0, {
            subject: "showBanner",
            message: "JavaScript URLs are not allowed in such operation.",
          });
        }
        return;
      }
      const forwarded: OpenLinkMessage = { ...parsed, url };
      if (parsed.tab.tabbed) {
        if (
          (sender?.frameId !== 0 && chrome.runtime.getURL("frontend.html") === sender?.url) ||
          !sender?.tab
        ) {
          // if current call was made from Omnibar, the sender.tab may be stale,
          // as sender was bound when port was created.
          await openUrlInNewTab(await getActiveTab(), url, forwarded);
        } else {
          await openUrlInNewTab(sender.tab, url, forwarded);
        }
      } else {
        const tab = await chrome.tabs.update({
          url: url,
          pinned: parsed.tab.pinned || sender?.tab?.pinned,
        });
        if (tab?.id != null && (parsed.scrollLeft || parsed.scrollTop)) {
          tabMessages[tab.id] = {
            scrollLeft: parsed.scrollLeft,
            scrollTop: parsed.scrollTop,
          };
        }
      }
    },
    viewSource: (message: unknown, sender?: chrome.runtime.MessageSender, sendResponse?) => {
      const parsed = v.parse(viewSourceSchema, message);
      const openLink = handlers["openLink"];
      if (openLink) {
        return openLink(
          { ...parsed, url: "view-source:" + (sender?.tab?.url ?? "") },
          sender,
          sendResponse,
        );
      }
      return undefined;
    },
    nextFrame: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const tid = sender?.tab?.id;
      if (tid == null) {
        return;
      }
      const { frameId } = v.parse(nextFrameSchema, message);
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
          if (framesInTab[i] === frameId) {
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
    moveTab: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const tab = sender?.tab;
      if (tab?.id == null) {
        return;
      }
      const { step, repeats } = v.parse(moveTabSchema, message);
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      const to = _fixTo(tab.index + step * (repeats ?? 1), tabs.length);
      chrome.tabs.move(tab.id, {
        index: to,
      });
    },
    tabURLAccessed: (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const tab = sender?.tab;
      if (tab?.id == null) {
        return {};
      }
      const { url, title } = v.parse(tabURLAccessedSchema, message);
      _setScrollPos_bg(tab.id);
      const urls = tabURLs[tab.id] ?? {};
      urls[url] = title;
      tabURLs[tab.id] = urls;
      return {
        active: tab.active,
        index: conf["showTabIndices"] ? tab.index + 1 : 0,
      };
    },
    getTabURLs: (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      const tabId = sender?.tab?.id;
      const tabURL = tabId != null ? (tabURLs[tabId] ?? {}) : {};
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
    getTopURL: (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      return {
        url: sender?.tab?.url ?? "",
      };
    },
    setZoom: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const tabId = sender?.tab?.id;
      if (tabId == null) {
        return;
      }
      const setZoomMessage = v.parse(setZoomSchema, message);
      const zoomFactor = setZoomMessage.zoomFactor * (setZoomMessage.repeats ?? 1);
      if (zoomFactor == 0) {
        const settings = await chrome.tabs.getZoomSettings(tabId);
        const defaultZoom = settings.defaultZoomFactor || 1;
        await chrome.tabs.setZoom(tabId, defaultZoom);
      } else {
        const zf = await chrome.tabs.getZoom(tabId);
        await chrome.tabs.setZoom(tabId, zf + zoomFactor);
      }
    },
    queueURLs: (message: unknown) => {
      _queueURLs = _queueURLs.concat(v.parse(queueURLsSchema, message).urls);
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
