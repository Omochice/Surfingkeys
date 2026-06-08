import { Result } from "@praha/byethrow";

import { chromeRuntimeError } from "../common/result";
import { request } from "./request";
import type { MessageHandler } from "./start";

/** Shallow-merges every own enumerable property of `ss` onto `target` in place. */
export function extendObject(target: any, ss: any): void {
  for (const k in ss) {
    target[k] = ss[k];
  }
}

/**
 * Projects `set` to the requested `keys`. A null/undefined/"" key set returns the whole object; a
 * single key or an array of keys returns just that subset.
 */
export function getSubSettings(set: any, keys: any): any {
  let subset: any;
  if (!keys) {
    // if null/undefined/""
    subset = set;
  } else {
    if (!Array.isArray(keys)) {
      keys = [keys];
    }
    subset = {};
    keys.forEach((k: string) => {
      subset[k] = set[k];
    });
  }
  return subset;
}

/**
 * Persists settings into a `chrome.storage` area. Sync storage has a quota, so snippets loaded from
 * a `localPath` are never written there; local storage instead re-fetches and caches the snippets
 * from that path before saving.
 */
export async function _save(storage: any, data: any): Promise<void> {
  // Persist a shallow copy so the caller's object is never stripped or
  // reassigned. `updateSettings` reads `message.settings.snippets` right after
  // this returns; mutating it in place dropped the snippets and unregistered
  // the user script.
  const toSave = { ...data };
  if (storage === chrome.storage.sync) {
    // don't store snippets from localPath into sync storage, since sync storage has its quota.
    if (toSave.localPath) {
      delete toSave.snippets;
      delete toSave.localPath;
    }
    if (Object.keys(toSave).length > 1) {
      await storage.set(toSave);
    }
  } else if (toSave.localPath) {
    delete toSave.snippets;
    // try to fetch snippets from localPath and cache it in local storage.
    const r = await request(toSave.localPath);
    if (Result.isSuccess(r)) {
      toSave.snippets = r.value;
    } else {
      // Leave the cached snippets untouched on failure, but still persist so the
      // chained `afterSet` (and the `updateSettings` response) never hangs on a
      // bad/unreachable snippet URL.
      console.error("Failed to fetch snippets from", toSave.localPath, r.error);
    }
    // storage.set may throw (e.g. quota); swallow so a caller awaiting _save
    // (and the response it settles) never hangs on a bad snippet path.
    try {
      await storage.set(toSave);
    } catch (err) {
      console.error("Failed to save snippets from", toSave.localPath, err);
    }
  } else {
    await storage.set(toSave);
  }
}

/**
 * Dependencies the settings subsystem cannot own: the per-browser glue from the composition root,
 * the shared mutable `conf` (also read by the tab handlers), and the tab-core primitives a few
 * settings actions reach into — `sendTabMessage` to broadcast updates, plus `tabMessages`,
 * `setScrollPos`, the shared `handlers` registry, `newTabUrl` and `quit` for the marks/session
 * actions that drive tab navigation.
 */
export type SettingsDeps = {
  conf: Record<string, any>;
  browser: any;
  sendTabMessage: (tabId: number, frameId: number, message: any) => void;
  tabMessages: Record<string, any>;
  setScrollPos: (tabId: number) => void;
  handlers: Record<string, MessageHandler>;
  newTabUrl: string;
  quit: () => void;
};

/**
 * What the composition root needs back from the settings subsystem: the handler map to register,
 * plus the three infra functions still called by misc handlers that stay in start.ts (`removeURL`'s
 * mark-deletion branch and `localData`).
 */
export type SettingsUnit = {
  handlers: Record<string, MessageHandler>;
  loadSettings: (keys: any) => Promise<any>;
  updateAndPostSettings: (diffSettings: any) => Promise<void>;
  broadcastSettings: (data: any) => Promise<void>;
};

/**
 * Settings subsystem: load/save/sync of settings, the blocklist/mouse-query state toggles, the
 * enable/disable state computation, VIM marks, and sessions. Owns the settings storage logic and
 * the user-script registration; takes its cross-concern dependencies by injection so it never
 * imports the tab core back. Handlers resolve to their response payload; the dispatcher in `start`
 * settles the sender.
 */
export function createSettings(deps: SettingsDeps): SettingsUnit {
  const { conf, browser, sendTabMessage, tabMessages, handlers, newTabUrl } = deps;
  const _setScrollPos_bg = deps.setScrollPos;
  const _quit = deps.quit;

  const isMV3 = chrome.runtime.getManifest().manifest_version === 3;

  async function loadSettings(keys: any): Promise<any> {
    const tmpSet = {
      blocklist: {},
      marks: {},
      findHistory: [],
      cmdHistory: [],
      sessions: {},
    };

    const set = await browser.loadRawSettings(keys, tmpSet);
    if (set.localPath) {
      const r = await request(appendNonce(set.localPath));
      if (Result.isSuccess(r)) {
        set.snippets = r.value;
      } else {
        set.error = "Failed to read snippets from " + set.localPath;
      }
    }
    return set;
  }

  async function _updateSettings(diffSettings: any): Promise<void> {
    diffSettings.savedAt = Date.now();
    await _save(chrome.storage.local, diffSettings);
    // The sync write is fire-and-forget (local is the source of truth), but a
    // rejection here (e.g. sync quota) must be caught: an unhandled rejection can
    // terminate the MV3 service worker.
    _save(chrome.storage.sync, diffSettings).catch((err) => {
      console.error("Failed to sync settings:", err);
    });
  }

  async function _broadcastSettings(data: any): Promise<void> {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
      sendTabMessage(tab.id!, -1, {
        subject: "settingsUpdated",
        settings: data,
      });
    });
  }

  async function _updateAndPostSettings(diffSettings: any): Promise<void> {
    await _broadcastSettings(diffSettings);
    await _updateSettings(diffSettings);
  }

  function getSenderUrl(sender: any) {
    // use the tab's url if sender is a frame with blank url.
    return sender.frameId !== 0 && sender.url === "about:blank" ? sender.tab.url : sender.url;
  }
  function _getState(set: any, url: any, blocklistPattern: any, lurkingPattern: any) {
    if (set.blocklist[".*"]) {
      return "disabled";
    }
    if (url) {
      if (set.blocklist[url.origin]) {
        return "disabled";
      }
      if (blocklistPattern) {
        blocklistPattern = new RegExp(blocklistPattern.source, blocklistPattern.flags);
        if (blocklistPattern.test(url.href)) {
          return "disabled";
        }
      }
      if (lurkingPattern) {
        lurkingPattern = new RegExp(lurkingPattern.source, lurkingPattern.flags);
        if (lurkingPattern.test(url.href)) {
          return "lurking";
        }
      }
    }
    return "enabled";
  }

  function appendNonce(url: string) {
    if (/https?:\/\//.test(url)) {
      url = url.replace(/\?$/, "");
      const u = new URL(url);
      const con = u.search ? "&" : "?";
      url = `${url}${con}nonce=${Date.now()}`;
    }
    return url;
  }

  async function _loadSettingsFromUrl(url: string): Promise<any> {
    const r = await request(appendNonce(url));
    if (Result.isSuccess(r)) {
      const resp = r.value;
      await _updateAndPostSettings({ localPath: url, snippets: resp });
      await registerUserScript(resp);
      return { status: "Succeeded", snippets: resp };
    }
    return { status: "Failed" };
  }

  async function registerUserScript(snippets: any): Promise<void> {
    if (!isUserScriptsAvailable()) {
      return;
    }
    const userScriptId = "settingsSnippets";
    if (snippets) {
      const r = await chrome.userScripts.getScripts({ ids: [userScriptId] });
      const code = `import('./api.js').then((module) => {module.default("${chrome.runtime.getURL("/")}", (api, settings) => {${snippets}\n})});`;
      const script = {
        allFrames: true,
        id: userScriptId,
        matches: ["*://*/*", "file:///*"],
        js: [{ code }],
      };
      if (r.length > 0) {
        if (r[0]!.js![0]!.code !== code) {
          await chrome.userScripts.unregister({ ids: [userScriptId] });
          await chrome.userScripts.register([script]);
        }
      } else {
        await chrome.userScripts.register([script]);
      }
    } else {
      const r = await chrome.userScripts.getScripts({ ids: [userScriptId] });
      if (r.length > 0) {
        await chrome.userScripts.unregister({ ids: [userScriptId] });
      }
    }
  }

  async function onFullSettingsRequested(data: any): Promise<void> {
    data.isMV3 = isMV3;
    data.isUserScriptsAvailable = isUserScriptsAvailable();
    if (isMV3) {
      data.showAdvanced = data.isUserScriptsAvailable && data.showAdvanced;
    }

    if (data.isUserScriptsAvailable && data.showAdvanced) {
      await registerUserScript(data.snippets);
    } else if (data.isUserScriptsAvailable) {
      await registerUserScript(null);
    }
  }

  function isUserScriptsAvailable(): boolean {
    const r = Result.try({
      try: () => Boolean(chrome.userScripts),
      catch: (cause) => chromeRuntimeError("userScripts feature detection", cause),
    });
    return Result.isSuccess(r) && r.value;
  }

  const handlersMap: Record<string, MessageHandler> = {
    toggleBlocklist: async (message: any, sender: any) => {
      const data = await loadSettings("blocklist");
      let origin = ".*";
      const senderOrigin = sender.origin || new URL(getSenderUrl(sender)).origin;
      if (
        chrome.runtime.getURL("/").toLowerCase().indexOf(senderOrigin.toLowerCase()) !== 0 &&
        senderOrigin !== "null"
      ) {
        origin = senderOrigin;
      }
      if (Object.hasOwn(data.blocklist, origin)) {
        delete data.blocklist[origin];
      } else {
        data.blocklist[origin] = 1;
      }
      await _updateAndPostSettings({ blocklist: data.blocklist });
      return {
        state: _getState(
          data,
          sender.tab ? new URL(getSenderUrl(sender)) : null,
          message.blocklistPattern,
          message.lurkingPattern,
        ),
        blocklist: data.blocklist,
        url: origin,
      };
    },
    toggleMouseQuery: async (message: any, sender: any) => {
      const data = await loadSettings("mouseSelectToQuery");
      if (sender.tab && sender.tab.url.indexOf(chrome.runtime.getURL("/")) !== 0) {
        const mouseSelectToQuery = data.mouseSelectToQuery || [];
        const idx = mouseSelectToQuery.indexOf(message.origin);
        if (idx === -1) {
          mouseSelectToQuery.push(message.origin);
        } else {
          mouseSelectToQuery.splice(idx, 1);
        }
        await _updateAndPostSettings({ mouseSelectToQuery: mouseSelectToQuery });
      }
    },
    getState: async (message: any, sender: any) => {
      const data = await loadSettings(["blocklist"]);
      if (sender.tab) {
        return {
          state: _getState(
            data,
            new URL(getSenderUrl(sender)),
            message.blocklistPattern,
            message.lurkingPattern,
          ),
        };
      }
      return undefined;
    },
    addVIMark: async (message: any) => {
      const data = await loadSettings("marks");
      extendObject(data.marks, message.mark);
      await _updateAndPostSettings({ marks: data.marks });
    },
    jumpVIMark: async (message: any, sender: any, sendResponse: any) => {
      const data = await loadSettings("marks");
      const marks = data.marks;
      if (!Object.hasOwn(marks, message.mark)) {
        return undefined;
      }
      const markInfo = marks[message.mark];
      const allTabs = await chrome.tabs.query({});
      const tabs = allTabs.filter((t) => {
        return t.url === markInfo.url;
      });

      if (tabs.length === 0) {
        markInfo.tab = {
          tabbed: true,
          active: true,
        };
        const openLink = handlers["openLink"];
        if (openLink) {
          return openLink(markInfo, sender, sendResponse);
        }
        return undefined;
      }
      if (markInfo.scrollLeft || markInfo.scrollTop) {
        tabMessages[tabs[0]!.id!] = {
          scrollLeft: markInfo.scrollLeft,
          scrollTop: markInfo.scrollTop,
        };
      }
      if (tabs[0]!.id === sender.tab.id) {
        _setScrollPos_bg(tabs[0]!.id!);
      } else {
        chrome.tabs.update(tabs[0]!.id!, {
          active: true,
        });
      }
      return undefined;
    },
    resetSettings: async () => {
      // The two clears are independent; run them concurrently but reload only
      // after both settle so the reload observes the cleared storage rather than
      // racing it and broadcasting stale settings.
      await Promise.all([chrome.storage.local.clear(), chrome.storage.sync.clear()]);
      const data = await loadSettings(null);
      await _broadcastSettings(data);
      return { settings: data };
    },
    loadSettingsFromUrl: (message: any) => _loadSettingsFromUrl(message.url),
    getSettings: async (message: any) => {
      let data: any;
      if (message.key === "RAW") {
        message.key = "";
        data = await browser.loadRawSettings(message.key);
      } else {
        data = await loadSettings(message.key);
      }
      if (message.key == null) {
        await onFullSettingsRequested(data);
      }
      return { settings: data };
    },
    updateSettings: async (message: any) => {
      const error = "";
      if (message.scope === "snippets") {
        // For settings from snippets, don't broadcast the update
        // neither persist into storage
        for (const k in message.settings) {
          if (Object.hasOwn(conf, k)) {
            conf[k] = message.settings[k];
          }
        }
        return { error };
      }
      if (message.settings.showAdvanced && isMV3) {
        if (!isUserScriptsAvailable()) {
          return {
            error:
              "Advanced mode is only available when Developer mode is turned on from chrome://extensions/.",
          };
        }
        chrome.userScripts.configureWorld({
          csp: "script-src 'self' 'unsafe-eval'",
          messaging: true,
        });
        await _updateAndPostSettings(message.settings);
        await registerUserScript(message.settings.snippets);
        return { error };
      }
      await _updateAndPostSettings(message.settings);
      return { error };
    },
    updateInputHistory: async (message: any) => {
      let key: string | undefined = undefined;
      let value: any;
      for (const k in message) {
        key = k + "History";
        value = message[k];
        break;
      }
      if (!key) {
        return undefined;
      }
      const data = await loadSettings(key);
      let curr = data[key] || [];
      const toUpdate: Record<string, any> = {};
      if (value.constructor.name === "Array") {
        toUpdate[key] = value;
        await _updateAndPostSettings(toUpdate);
      } else if (value.trim().length && value !== ".") {
        curr = curr.filter((c: string) => {
          return c.trim().length && c !== value && c !== ".";
        });
        curr.unshift(value);
        if (curr.length > 50) {
          curr.pop();
        }
        toUpdate[key] = curr;
        await _updateAndPostSettings(toUpdate);
      }
      return { history: curr };
    },
    createSession: async (message: any) => {
      const data = await loadSettings("sessions");
      const tabs = await chrome.tabs.query({});
      const tabGroup: Record<string, any[]> = {};
      tabs.forEach((tab) => {
        if (tab && tab.index !== void 0) {
          if (!Object.hasOwn(tabGroup, tab.windowId)) {
            tabGroup[tab.windowId] = [];
          }
          const group = tabGroup[tab.windowId];
          if (group && tab.url !== newTabUrl) {
            group.push(tab.url);
          }
        }
      });
      const tabg = [];
      for (const k in tabGroup) {
        const group = tabGroup[k];
        if (group && group.length) {
          tabg.push(group);
        }
      }
      data.sessions[message.name] = {};
      data.sessions[message.name]["tabs"] = tabg;
      await _updateAndPostSettings({
        sessions: data.sessions,
      });
      if (message.quitAfterSaved) {
        _quit();
      }
    },
    openSession: async (message: any) => {
      const data = await loadSettings("sessions");
      if (!Object.hasOwn(data.sessions, message.name)) {
        return;
      }
      const urls = data.sessions[message.name]["tabs"];
      urls[0].forEach((url: string) => {
        chrome.tabs.create({
          url: url,
          active: false,
          pinned: false,
        });
      });
      for (let i = 1; i < urls.length; i++) {
        const a = urls[i];
        const win = await chrome.windows.create({});
        a.forEach((url: string) => {
          chrome.tabs.create({
            windowId: win!.id,
            url: url,
            active: false,
            pinned: false,
          });
        });
      }
      const tabs = await chrome.tabs.query({ url: newTabUrl });
      chrome.tabs.remove(
        tabs.map((t) => {
          return t.id!;
        }),
      );
    },
    deleteSession: async (message: any) => {
      const data = await loadSettings("sessions");
      delete data.sessions[message.name];
      await _updateAndPostSettings({
        sessions: data.sessions,
      });
    },
  };

  return {
    handlers: handlersMap,
    loadSettings,
    updateAndPostSettings: _updateAndPostSettings,
    broadcastSettings: _broadcastSettings,
  };
}
