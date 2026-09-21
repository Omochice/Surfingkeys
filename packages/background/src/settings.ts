import { Result } from "@praha/byethrow";
import { chromeRuntimeError } from "@sk/common/result";
import * as v from "valibot";

import { LOG } from "./log";
import { request } from "./request";
import type { BackgroundConf, BrowserAdapter, MessageHandler } from "./start";

// Settings fields read from storage are validated before use; storage is a
// trust boundary, so each consumed field is narrowed from `unknown`.
const patternSchema = v.optional(v.object({ source: v.string(), flags: v.string() }));
const blocklistSchema = v.record(v.string(), v.unknown());
const mouseSelectToQuerySchema = v.optional(v.array(v.string()));
const marksSchema = v.record(v.string(), v.record(v.string(), v.unknown()));
const togglePatternMessageSchema = v.object({
  blocklistPattern: patternSchema,
  lurkingPattern: patternSchema,
});
const mouseQueryMessageSchema = v.object({ origin: v.string() });
const addVIMarkMessageSchema = v.object({ mark: v.record(v.string(), v.unknown()) });
const jumpVIMarkMessageSchema = v.object({ mark: v.string() });
const urlMessageSchema = v.object({ url: v.string() });
const inputHistorySchema = v.optional(v.array(v.string()));
const sessionsSchema = v.record(v.string(), v.record(v.string(), v.unknown()));
const sessionTabsSchema = v.object({ tabs: v.array(v.array(v.string())) });
const createSessionMessageSchema = v.object({
  name: v.string(),
  quitAfterSaved: v.optional(v.boolean()),
});
const sessionNameMessageSchema = v.object({ name: v.string() });
const getSettingsMessageSchema = v.object({
  key: v.optional(v.union([v.string(), v.array(v.string()), v.null()])),
});
const updateSettingsMessageSchema = v.object({
  scope: v.optional(v.string()),
  settings: v.record(v.string(), v.unknown()),
});

/** Shallow-merges every own enumerable property of `source` onto `target` in place. */
export function extendObject(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const k in source) {
    target[k] = source[k];
  }
}

/**
 * Projects `set` to the requested `keys`. A null/undefined/"" key set returns the whole object; a
 * single key or an array of keys returns just that subset.
 */
export function getSubSettings(
  set: Record<string, unknown>,
  keys: string | readonly string[] | null | undefined,
): Record<string, unknown> {
  if (!keys) {
    return set;
  }
  const keyList = Array.isArray(keys) ? keys : [keys];
  const subset: Record<string, unknown> = {};
  keyList.forEach((k: string) => {
    subset[k] = set[k];
  });
  return subset;
}

/**
 * Persists settings into a `chrome.storage` area. Sync storage has a quota, so snippets loaded from
 * a `localPath` are never written there; local storage instead re-fetches and caches the snippets
 * from that path before saving.
 */
export async function save(
  storage: { set: (items: Record<string, unknown>) => Promise<void> },
  data: Record<string, unknown>,
): Promise<void> {
  // Persist a shallow copy so the caller's object is never stripped or reassigned.
  const toSave: Record<string, unknown> = { ...data };
  if (storage === chrome.storage.sync) {
    if (toSave["localPath"]) {
      delete toSave["snippets"];
      delete toSave["localPath"];
    }
    if (Object.keys(toSave).length > 1) {
      await storage.set(toSave);
    }
  } else if (typeof toSave["localPath"] === "string" && toSave["localPath"] !== "") {
    // An empty path is "no remote settings", not a URL: fetched from the service worker it would
    // resolve to background.js itself and get installed as the user's snippets.
    const localPath = toSave["localPath"];
    delete toSave["snippets"];
    const r = await request(localPath);
    if (Result.isSuccess(r)) {
      toSave["snippets"] = r.value;
    } else {
      // Leave the cached snippets untouched on failure, but still persist so the
      // chained `afterSet` (and the `updateSettings` response) never hangs on a
      // bad/unreachable snippet URL.
      LOG("error", "Failed to fetch snippets from", localPath, r.error);
    }
    // storage.set may throw (e.g. quota); swallow so a caller awaiting save
    // (and the response it settles) never hangs on a bad snippet path.
    try {
      await storage.set(toSave);
    } catch (error) {
      LOG("error", "Failed to save snippets from", localPath, error);
    }
  } else {
    await storage.set(toSave);
  }
}

/** Cross-concern dependencies the settings subsystem takes by injection rather than importing. */
export type SettingsDeps = {
  conf: BackgroundConf;
  browser: Pick<BrowserAdapter, "loadRawSettings">;
  sendTabMessage: (tabId: number, frameId: number, message: unknown) => void;
  tabMessages: Record<string, unknown>;
  setScrollPos: (tabId: number) => void;
  handlers: Record<string, MessageHandler>;
  newTabUrl: string;
  quit: () => void;
};

/** The settings subsystem's handler map, plus the settings functions other handlers reuse. */
export type SettingsUnit = {
  handlers: Record<string, MessageHandler>;
  loadSettings: (
    keys: string | readonly string[] | null | undefined,
  ) => Promise<Record<string, unknown>>;
  updateAndPostSettings: (diffSettings: Record<string, unknown>) => Promise<void>;
  broadcastSettings: (data: Record<string, unknown>) => Promise<void>;
};

/**
 * Settings subsystem: load/save/sync of settings, the blocklist/mouse-query toggles, the
 * enable/disable state computation, user-script registration, VIM marks, and sessions.
 */
export function createSettings(deps: SettingsDeps): SettingsUnit {
  const { conf, browser, sendTabMessage, tabMessages, handlers, newTabUrl } = deps;
  const setScrollPos_bg = deps.setScrollPos;
  const quit = deps.quit;

  const isMV3 = chrome.runtime.getManifest().manifest_version === 3;

  async function loadSettings(
    keys: string | readonly string[] | null | undefined,
  ): Promise<Record<string, unknown>> {
    const tmpSet = {
      blocklist: {},
      marks: {},
      findHistory: [],
      cmdHistory: [],
      sessions: {},
    };

    const set: Record<string, unknown> = await browser.loadRawSettings(keys, tmpSet);
    const localPath = set["localPath"];
    // Same empty-path guard as save(): "" would fetch background.js as the snippets.
    if (typeof localPath === "string" && localPath !== "") {
      const r = await request(appendNonce(localPath));
      if (Result.isSuccess(r)) {
        set["snippets"] = r.value;
      } else {
        set["error"] = "Failed to read snippets from " + localPath;
      }
    }
    return set;
  }

  async function updateSettings(diffSettings: Record<string, unknown>): Promise<void> {
    diffSettings["savedAt"] = Date.now();
    await save(chrome.storage.local, diffSettings);
    // The sync write is fire-and-forget (local is the source of truth), but a
    // rejection here (e.g. sync quota) must be caught: an unhandled rejection can
    // terminate the MV3 service worker.
    save(chrome.storage.sync, diffSettings).catch((error) => {
      LOG("error", "Failed to sync settings:", error);
    });
  }

  async function broadcastSettings(data: Record<string, unknown>): Promise<void> {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
      if (tab.id != null) {
        sendTabMessage(tab.id, -1, {
          subject: "settingsUpdated",
          settings: data,
        });
      }
    });
  }

  async function updateAndPostSettings(diffSettings: Record<string, unknown>): Promise<void> {
    await broadcastSettings(diffSettings);
    await updateSettings(diffSettings);
  }

  function getSenderUrl(sender: chrome.runtime.MessageSender): string | undefined {
    return sender.frameId !== 0 && sender.url === "about:blank" ? sender.tab?.url : sender.url;
  }
  function getState(
    blocklist: Record<string, unknown>,
    url: URL | null,
    patterns: v.InferOutput<typeof togglePatternMessageSchema>,
  ) {
    const { blocklistPattern, lurkingPattern } = patterns;
    if (blocklist[".*"]) {
      return "disabled";
    }
    if (url) {
      if (blocklist[url.origin]) {
        return "disabled";
      }
      if (blocklistPattern) {
        const re = new RegExp(blocklistPattern.source, blocklistPattern.flags);
        if (re.test(url.href)) {
          return "disabled";
        }
      }
      if (lurkingPattern) {
        const re = new RegExp(lurkingPattern.source, lurkingPattern.flags);
        if (re.test(url.href)) {
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

  async function loadSettingsFromUrl(url: string): Promise<{ status: string; snippets?: string }> {
    const r = await request(appendNonce(url));
    if (Result.isSuccess(r)) {
      const resp = r.value;
      await updateAndPostSettings({ localPath: url, snippets: resp });
      await registerUserScript(resp);
      return { status: "Succeeded", snippets: resp };
    }
    return { status: "Failed" };
  }

  async function registerUserScript(snippets: unknown): Promise<void> {
    if (!isUserScriptsAvailable()) {
      return;
    }
    const userScriptId = "settingsSnippets";
    if (typeof snippets === "string" && snippets) {
      const r = await chrome.userScripts.getScripts({ ids: [userScriptId] });
      const code = `import('./api.js').then((module) => {module.default("${chrome.runtime.getURL("/")}", (api, settings) => {${snippets}\n})});`;
      const script = {
        allFrames: true,
        id: userScriptId,
        matches: ["*://*/*", "file:///*"],
        js: [{ code }],
        // The default, document_idle, lets the page's first keystrokes reach the built-in
        // mappings before the snippet has had a chance to override them.
        runAt: "document_start" as const,
      };
      if (r.length > 0) {
        const registered = r[0];
        if (registered?.js?.[0]?.code !== code || registered.runAt !== script.runAt) {
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

  async function onFullSettingsRequested(data: Record<string, unknown>): Promise<void> {
    data["isMV3"] = isMV3;
    data["isUserScriptsAvailable"] = isUserScriptsAvailable();
    if (isMV3) {
      data["showAdvanced"] = data["isUserScriptsAvailable"] && data["showAdvanced"];
    }
    if (!data["isUserScriptsAvailable"]) {
      return;
    }

    // Propagating this failure would answer the read with an error instead of the stored settings,
    // although the read never asked for the script to change.
    const r = await Result.try({
      try: () => registerUserScript(data["showAdvanced"] ? data["snippets"] : null),
      catch: (cause) => chromeRuntimeError("registerUserScript", cause),
    });
    if (Result.isFailure(r)) {
      LOG(
        "error",
        "Failed to register the snippets user script for a settings read:",
        r.error.cause,
      );
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
    toggleBlocklist: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      if (!sender) {
        return undefined;
      }
      const patterns = v.parse(togglePatternMessageSchema, message);
      const data = await loadSettings("blocklist");
      const blocklist = v.parse(blocklistSchema, data["blocklist"]);
      const senderUrl = getSenderUrl(sender);
      let origin = ".*";
      const senderOrigin = sender.origin || (senderUrl != null ? new URL(senderUrl).origin : "");
      if (
        chrome.runtime.getURL("/").toLowerCase().indexOf(senderOrigin.toLowerCase()) !== 0 &&
        senderOrigin !== "null"
      ) {
        origin = senderOrigin;
      }
      if (Object.hasOwn(blocklist, origin)) {
        delete blocklist[origin];
      } else {
        blocklist[origin] = 1;
      }
      await updateAndPostSettings({ blocklist });
      return {
        state: getState(
          blocklist,
          sender.tab && senderUrl != null ? new URL(senderUrl) : null,
          patterns,
        ),
        blocklist,
        url: origin,
      };
    },
    toggleMouseQuery: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const { origin } = v.parse(mouseQueryMessageSchema, message);
      const data = await loadSettings("mouseSelectToQuery");
      const senderTabUrl = sender?.tab?.url;
      if (senderTabUrl != null && senderTabUrl.indexOf(chrome.runtime.getURL("/")) !== 0) {
        const mouseSelectToQuery =
          v.parse(mouseSelectToQuerySchema, data["mouseSelectToQuery"]) ?? [];
        const idx = mouseSelectToQuery.indexOf(origin);
        if (idx === -1) {
          mouseSelectToQuery.push(origin);
        } else {
          mouseSelectToQuery.splice(idx, 1);
        }
        await updateAndPostSettings({ mouseSelectToQuery });
      }
    },
    getState: async (message: unknown, sender?: chrome.runtime.MessageSender) => {
      const patterns = v.parse(togglePatternMessageSchema, message);
      const data = await loadSettings(["blocklist"]);
      if (sender?.tab) {
        const senderUrl = getSenderUrl(sender);
        return {
          state: getState(
            v.parse(blocklistSchema, data["blocklist"]),
            senderUrl != null ? new URL(senderUrl) : null,
            patterns,
          ),
        };
      }
      return undefined;
    },
    addVIMark: async (message: unknown) => {
      const { mark } = v.parse(addVIMarkMessageSchema, message);
      const data = await loadSettings("marks");
      const marks = v.parse(marksSchema, data["marks"]);
      extendObject(marks, mark);
      await updateAndPostSettings({ marks });
    },
    jumpVIMark: async (message: unknown, sender?: chrome.runtime.MessageSender, sendResponse?) => {
      const { mark } = v.parse(jumpVIMarkMessageSchema, message);
      const data = await loadSettings("marks");
      const marks = v.parse(marksSchema, data["marks"]);
      const markInfo = marks[mark];
      if (!markInfo) {
        return undefined;
      }
      const allTabs = await chrome.tabs.query({});
      const tabs = allTabs.filter((t) => {
        return t.url === markInfo["url"];
      });

      if (tabs.length === 0) {
        markInfo["tab"] = {
          tabbed: true,
          active: true,
        };
        const openLink = handlers["openLink"];
        if (openLink) {
          return openLink(markInfo, sender, sendResponse);
        }
        return undefined;
      }
      const firstTabId = tabs[0]?.id;
      if (firstTabId == null) {
        return undefined;
      }
      if (markInfo["scrollLeft"] || markInfo["scrollTop"]) {
        tabMessages[firstTabId] = {
          scrollLeft: markInfo["scrollLeft"],
          scrollTop: markInfo["scrollTop"],
        };
      }
      if (firstTabId === sender?.tab?.id) {
        setScrollPos_bg(firstTabId);
      } else {
        chrome.tabs.update(firstTabId, {
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
      await broadcastSettings(data);
      return { settings: data };
    },
    loadSettingsFromUrl: (message: unknown) =>
      loadSettingsFromUrl(v.parse(urlMessageSchema, message).url),
    getSettings: async (message: unknown) => {
      const parsed = v.parse(getSettingsMessageSchema, message);
      let key = parsed.key;
      let data: Record<string, unknown>;
      if (key === "RAW") {
        key = "";
        data = await browser.loadRawSettings(key);
      } else {
        data = await loadSettings(key);
      }
      if (key == null) {
        await onFullSettingsRequested(data);
      }
      return { settings: data };
    },
    updateSettings: async (message: unknown) => {
      const { scope, settings } = v.parse(updateSettingsMessageSchema, message);
      const error = "";
      if (scope === "snippets") {
        // For settings from snippets, don't broadcast the update
        // neither persist into storage
        const confKeys = [
          "focusAfterClosed",
          "tabsMRUOrder",
          "newTabPosition",
          "showTabIndices",
          "interceptedErrors",
        ] as const;
        for (const k of confKeys) {
          if (Object.hasOwn(settings, k)) {
            Object.assign(conf, { [k]: settings[k] });
          }
        }
        return { error };
      }
      if (settings["showAdvanced"] && isMV3) {
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
        await updateAndPostSettings(settings);
        await registerUserScript(settings["snippets"]);
        return { error };
      }
      await updateAndPostSettings(settings);
      return { error };
    },
    updateInputHistory: async (message: unknown) => {
      const record = v.parse(v.record(v.string(), v.unknown()), message);
      let key: string | undefined = undefined;
      let value: unknown;
      for (const k in record) {
        key = k + "History";
        value = record[k];
        break;
      }
      if (!key) {
        return undefined;
      }
      const data = await loadSettings(key);
      let curr = v.parse(inputHistorySchema, data[key]) ?? [];
      const toUpdate: Record<string, unknown> = {};
      if (Array.isArray(value)) {
        toUpdate[key] = value;
        await updateAndPostSettings(toUpdate);
      } else if (typeof value === "string" && value.trim().length && value !== ".") {
        curr = curr.filter((c) => {
          return c.trim().length && c !== value && c !== ".";
        });
        curr.unshift(value);
        if (curr.length > 50) {
          curr.pop();
        }
        toUpdate[key] = curr;
        await updateAndPostSettings(toUpdate);
      }
      return { history: curr };
    },
    createSession: async (message: unknown) => {
      const { name, quitAfterSaved } = v.parse(createSessionMessageSchema, message);
      const data = await loadSettings("sessions");
      const sessions = v.parse(sessionsSchema, data["sessions"]);
      const tabs = await chrome.tabs.query({});
      const tabGroup: Record<number, (string | undefined)[]> = {};
      tabs.forEach((tab) => {
        if (tab.index !== undefined) {
          const group = tabGroup[tab.windowId] ?? [];
          if (tab.url !== newTabUrl) {
            group.push(tab.url);
          }
          tabGroup[tab.windowId] = group;
        }
      });
      const tabGroups: (string | undefined)[][] = [];
      for (const k in tabGroup) {
        const group = tabGroup[k];
        if (group && group.length) {
          tabGroups.push(group);
        }
      }
      sessions[name] = { tabs: tabGroups };
      await updateAndPostSettings({
        sessions,
      });
      if (quitAfterSaved) {
        quit();
      }
    },
    openSession: async (message: unknown) => {
      const { name } = v.parse(sessionNameMessageSchema, message);
      const data = await loadSettings("sessions");
      const sessions = v.parse(sessionsSchema, data["sessions"]);
      const session = sessions[name];
      if (!session) {
        return;
      }
      const { tabs: urls } = v.parse(sessionTabsSchema, session);
      urls[0]?.forEach((url) => {
        chrome.tabs.create({
          url: url,
          active: false,
          pinned: false,
        });
      });
      for (let i = 1; i < urls.length; i++) {
        const win = await chrome.windows.create({});
        urls[i]?.forEach((url) => {
          chrome.tabs.create({
            windowId: win?.id,
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
    deleteSession: async (message: unknown) => {
      const { name } = v.parse(sessionNameMessageSchema, message);
      const data = await loadSettings("sessions");
      const sessions = v.parse(sessionsSchema, data["sessions"]);
      delete sessions[name];
      await updateAndPostSettings({
        sessions,
      });
    },
  };

  return {
    handlers: handlersMap,
    loadSettings,
    updateAndPostSettings: updateAndPostSettings,
    broadcastSettings: broadcastSettings,
  };
}
