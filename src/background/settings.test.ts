import { Result } from "@praha/byethrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../test/helpers";
import { httpError } from "../common/result";
import type { SettingsDeps } from "./settings";
import { _save, createSettings, extendObject, getSubSettings } from "./settings";

// `_save` reaches the network through the request module on its local-storage
// path; mock the module so that path is observable without a real fetch.
const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));
vi.mock("./request.js", () => ({ request: mockRequest }));

type AnyChrome = { runtime?: any; storage?: any; tabs?: any; userScripts?: any };
const g = globalThis as unknown as { chrome: AnyChrome };
const defaultStorage = g.chrome.storage;

afterEach(() => {
  g.chrome.storage = defaultStorage;
  delete g.chrome.tabs;
  delete g.chrome.userScripts;
  mockRequest.mockReset();
});

/** Builds a settings unit with inert defaults; override only what a test needs. */
function makeUnit(over: Partial<SettingsDeps> = {}) {
  const deps: SettingsDeps = {
    _response: vi.fn(),
    conf: {},
    browser: { loadRawSettings: (_keys: any, cb: any) => cb({}) },
    sendTabMessage: vi.fn(),
    tabMessages: {},
    setScrollPos: vi.fn(),
    handlers: {},
    newTabUrl: "about:newtab",
    quit: vi.fn(),
    ...over,
  };
  return { unit: createSettings(deps), deps };
}

describe("getSubSettings", () => {
  const set = { a: 1, b: 2, c: 3 };

  it("returns the whole set for a null/empty/undefined key", () => {
    expect(getSubSettings(set, null)).toBe(set);
    expect(getSubSettings(set, "")).toBe(set);
    expect(getSubSettings(set, undefined)).toBe(set);
  });

  it("projects a single key to a one-entry subset", () => {
    expect(getSubSettings(set, "b")).toEqual({ b: 2 });
  });

  it("projects an array of keys to that subset", () => {
    expect(getSubSettings(set, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });
});

describe("_save", () => {
  it("strips snippets/localPath before writing to sync storage", () => {
    const set = vi.fn();
    const sync = { set };
    g.chrome.storage = { local: {}, sync };
    const cb = vi.fn();

    _save(sync, { localPath: "/x", snippets: "s", foo: 1, bar: 2 }, cb);

    expect(set).toHaveBeenCalledWith({ foo: 1, bar: 2 }, cb);
  });

  it("skips the sync write when only localPath/snippets were present", () => {
    const set = vi.fn();
    const sync = { set };
    g.chrome.storage = { local: {}, sync };

    _save(sync, { localPath: "/x", snippets: "s" });

    expect(set).not.toHaveBeenCalled();
  });

  it("fetches and caches snippets from localPath before writing to local storage", async () => {
    mockRequest.mockResolvedValue(Result.succeed("FETCHED"));
    const set = vi.fn();
    const local = { set };
    g.chrome.storage = { local, sync: {} };

    _save(local, { localPath: "/snips.js", snippets: "stale" });
    await vi.waitFor(() => expect(set).toHaveBeenCalled());

    expect(mockRequest).toHaveBeenCalledWith("/snips.js");
    expect(set).toHaveBeenCalledWith({ localPath: "/snips.js", snippets: "FETCHED" }, undefined);
  });

  it("does not mutate the caller's data when caching snippets to local storage", async () => {
    mockRequest.mockResolvedValue(Result.succeed("FETCHED"));
    const set = vi.fn();
    const local = { set };
    g.chrome.storage = { local, sync: {} };
    const data = { localPath: "/snips.js", snippets: "stale" };

    _save(local, data);
    await vi.waitFor(() => expect(set).toHaveBeenCalled());

    expect(data).toEqual({ localPath: "/snips.js", snippets: "stale" });
    expect(set).toHaveBeenCalledWith({ localPath: "/snips.js", snippets: "FETCHED" }, undefined);
  });

  it("does not mutate the caller's data when stripping for sync storage", () => {
    const set = vi.fn();
    const sync = { set };
    g.chrome.storage = { local: {}, sync };
    const data = { localPath: "/x", snippets: "s", foo: 1, bar: 2 };

    _save(sync, data, vi.fn());

    expect(data).toEqual({ localPath: "/x", snippets: "s", foo: 1, bar: 2 });
    expect(set).toHaveBeenCalledWith({ foo: 1, bar: 2 }, expect.any(Function));
  });

  it("still writes to local storage and fires cb when the snippet fetch fails", async () => {
    // A failed fetch must not strand callers: `cb` is what `_updateSettings`
    // chains `afterSet` onto, and the `updateSettings` handler ultimately calls
    // `_response` from there, so dropping it hangs the response forever.
    mockRequest.mockResolvedValue(Result.fail(httpError("/snips.js", new Error("404"), 404)));
    const set = vi.fn();
    const local = { set };
    g.chrome.storage = { local, sync: {} };
    const cb = vi.fn();
    const data = { localPath: "/snips.js", snippets: "stale" };

    _save(local, data, cb);
    await vi.waitFor(() => expect(set).toHaveBeenCalled());

    expect(cb).toBe(set.mock.calls.at(-1)?.[1]);
    expect(set).toHaveBeenCalledWith({ localPath: "/snips.js" }, cb);
    // The caller's object is left intact; only the persisted copy drops snippets.
    expect(data).toEqual({ localPath: "/snips.js", snippets: "stale" });
  });

  it("still fires cb when storage.set throws after a snippet fetch", async () => {
    mockRequest.mockResolvedValue(Result.succeed("FETCHED"));
    const set = vi.fn(() => {
      throw new Error("quota exceeded");
    });
    const local = { set };
    g.chrome.storage = { local, sync: {} };
    const cb = vi.fn();

    _save(local, { localPath: "/snips.js", snippets: "stale" }, cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
  });
});

describe("createSettings — getState", () => {
  /** Drives the getState handler and returns the computed state string. */
  function stateFor(blocklist: any, message: any = {}, senderUrl = "https://example.com/") {
    const _response = vi.fn();
    const { unit } = makeUnit({
      _response,
      browser: { loadRawSettings: (_keys: any, cb: any) => cb({ blocklist }) },
    });
    const sender = { tab: { id: 1 }, url: senderUrl, frameId: 0 };
    const getState = unit.handlers["getState"];
    expectDefined(getState);
    getState(message, sender, vi.fn());
    return _response.mock.calls.at(-1)?.[2].state;
  }

  it("is disabled when the catch-all blocklist entry is set", () => {
    expect(stateFor({ ".*": 1 })).toBe("disabled");
  });

  it("is disabled when the sender origin is blocklisted", () => {
    expect(stateFor({ "https://example.com": 1 })).toBe("disabled");
  });

  it("is disabled when the url matches the blocklist pattern", () => {
    expect(stateFor({}, { blocklistPattern: { source: "example\\.com", flags: "" } })).toBe(
      "disabled",
    );
  });

  it("is lurking when the url matches the lurking pattern", () => {
    expect(stateFor({}, { lurkingPattern: { source: "example\\.com", flags: "" } })).toBe(
      "lurking",
    );
  });

  it("is enabled when nothing matches", () => {
    expect(stateFor({})).toBe("enabled");
  });
});

describe("createSettings — updateSettings", () => {
  it("mutates only known conf keys for the snippets scope, without broadcasting", () => {
    const sendTabMessage = vi.fn();
    const conf: Record<string, any> = { tabsMRUOrder: true };
    const { unit } = makeUnit({ conf, sendTabMessage });

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    const result = updateSettings(
      { scope: "snippets", settings: { tabsMRUOrder: false, unknownKey: 9 } },
      {},
      vi.fn(),
    );

    expect(conf["tabsMRUOrder"]).toBe(false);
    expect("unknownKey" in conf).toBe(false);
    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "" });
  });

  it("broadcasts the diff to every tab and persists it for a normal update", () => {
    const sendTabMessage = vi.fn();
    const localSet = vi.fn((_data: any, cb?: () => void) => cb && cb());
    const syncSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: syncSet } };
    g.chrome.tabs = {
      query: (_q: any, cb: (tabs: any[]) => void) => cb([{ id: 11 }, { id: 22 }]),
    };
    const { unit } = makeUnit({ sendTabMessage });

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    updateSettings({ settings: { foo: 1 } }, {}, vi.fn());

    expect(sendTabMessage.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [11, -1],
      [22, -1],
    ]);
    expect(localSet).toHaveBeenCalled();
  });

  it("registers the user script with the snippets when saving advanced settings with a localPath", () => {
    // The bug: _save synchronously deletes snippets from the shared settings
    // object before registerUserScript reads message.settings.snippets, so the
    // snippet code was lost and the script unregistered.
    mockRequest.mockResolvedValue(Result.succeed("FETCHED"));
    const register = vi.fn((_scripts: any, cb?: () => void) => cb && cb());
    g.chrome.userScripts = {
      configureWorld: vi.fn(),
      getScripts: (_q: any, cb: (r: any[]) => void) => cb([]),
      register,
      unregister: (_q: any, cb?: () => void) => cb && cb(),
    };
    g.chrome.storage = {
      local: { set: (_d: any, cb?: () => void) => cb && cb() },
      sync: { set: vi.fn() },
    };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };
    const { unit } = makeUnit();

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    updateSettings(
      { settings: { showAdvanced: true, localPath: "/snips.js", snippets: "SNIPPET_MARKER" } },
      {},
      vi.fn(),
    );

    expect(register).toHaveBeenCalled();
    const code = register.mock.calls.at(-1)?.[0][0].js[0].code;
    expect(code).toContain("SNIPPET_MARKER");
  });

  it("returns an error when showAdvanced is requested but userScripts API is unavailable", () => {
    // userScripts is absent from chrome stub → isUserScriptsAvailable() returns false
    const { unit } = makeUnit();

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    const result = updateSettings({ settings: { showAdvanced: true } }, {}, vi.fn());

    expect(result).toEqual({
      error: expect.stringContaining("Developer mode"),
    });
  });
});

describe("extendObject", () => {
  it("merges all own enumerable properties from source onto target in place", () => {
    const target: Record<string, any> = { a: 1 };
    extendObject(target, { b: 2, c: 3 });
    expect(target).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("overwrites existing keys on target", () => {
    const target: Record<string, any> = { x: "old" };
    extendObject(target, { x: "new" });
    expect(target["x"]).toBe("new");
  });
});

describe("createSettings — loadSettings (via getSettings handler)", () => {
  it("resolves snippets from localPath and delivers them to the callback", async () => {
    mockRequest.mockResolvedValue(Result.succeed("SNIPPET_BODY"));
    const _response = vi.fn();
    const { unit } = makeUnit({
      _response,
      browser: {
        loadRawSettings: (_keys: any, cb: any) => cb({ localPath: "http://example.com/snips.js" }),
      },
    });

    const getSettings = unit.handlers["getSettings"];
    expectDefined(getSettings);
    getSettings({ key: "localPath" }, {}, vi.fn());

    await vi.waitFor(() => expect(_response).toHaveBeenCalled());
    const settings = _response.mock.calls.at(-1)?.[2].settings;
    expect(settings.snippets).toBe("SNIPPET_BODY");
  });

  it("sets an error field when the localPath fetch fails", async () => {
    mockRequest.mockResolvedValue(
      Result.fail(httpError("http://example.com/snips.js", new Error("404"), 404)),
    );
    const _response = vi.fn();
    const { unit } = makeUnit({
      _response,
      browser: {
        loadRawSettings: (_keys: any, cb: any) => cb({ localPath: "http://example.com/snips.js" }),
      },
    });

    const getSettings = unit.handlers["getSettings"];
    expectDefined(getSettings);
    getSettings({ key: "localPath" }, {}, vi.fn());

    await vi.waitFor(() => expect(_response).toHaveBeenCalled());
    const settings = _response.mock.calls.at(-1)?.[2].settings;
    expect(settings.error).toMatch(/Failed to read snippets/);
  });

  it("bypasses loadSettings and uses browser.loadRawSettings directly for key=RAW", () => {
    const _response = vi.fn();
    const loadRawSettings = vi.fn((_keys: any, cb: any) => cb({ raw: true }));
    const { unit } = makeUnit({ _response, browser: { loadRawSettings } });

    const getSettings = unit.handlers["getSettings"];
    expectDefined(getSettings);
    getSettings({ key: "RAW" }, {}, vi.fn());

    // loadRawSettings must have been called with the key cleared to ""
    expect(loadRawSettings).toHaveBeenCalledWith("", expect.any(Function));
    expect(_response.mock.calls.at(-1)?.[2].settings).toEqual({ raw: true });
  });
});

describe("createSettings — toggleBlocklist", () => {
  function makeTabsChrome(localSet: any, syncSet: any) {
    g.chrome.storage = { local: { set: localSet }, sync: { set: syncSet } };
    g.chrome.tabs = {
      query: (_q: any, cb: (tabs: any[]) => void) => cb([]),
    };
  }

  it("adds a new origin to the blocklist and sends back the updated state", () => {
    const localSet = vi.fn((_d: any, cb?: () => void) => cb && cb());
    const syncSet = vi.fn();
    makeTabsChrome(localSet, syncSet);

    const sendResponse = vi.fn();
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: (_keys: any, cb: any) => cb({ blocklist: {} }),
      },
    });

    const toggleBlocklist = unit.handlers["toggleBlocklist"];
    expectDefined(toggleBlocklist);
    toggleBlocklist(
      {},
      {
        origin: "https://example.com",
        tab: { id: 1 },
        url: "https://example.com/page",
        frameId: 0,
      },
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ blocklist: { "https://example.com": 1 } }),
    );
  });

  it("removes an already-blocked origin from the blocklist", () => {
    const localSet = vi.fn((_d: any, cb?: () => void) => cb && cb());
    makeTabsChrome(localSet, vi.fn());

    const sendResponse = vi.fn();
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: (_keys: any, cb: any) => cb({ blocklist: { "https://example.com": 1 } }),
      },
    });

    const toggleBlocklist = unit.handlers["toggleBlocklist"];
    expectDefined(toggleBlocklist);
    toggleBlocklist(
      {},
      {
        origin: "https://example.com",
        tab: { id: 1 },
        url: "https://example.com/page",
        frameId: 0,
      },
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ blocklist: {} }));
  });
});

describe("createSettings — toggleMouseQuery", () => {
  it("adds a new origin to mouseSelectToQuery when it is not already present", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };
    const sendTabMessage = vi.fn();

    const { unit } = makeUnit({
      sendTabMessage,
      browser: {
        loadRawSettings: (_keys: any, cb: any) => cb({ mouseSelectToQuery: ["https://other.com"] }),
      },
    });

    const toggleMouseQuery = unit.handlers["toggleMouseQuery"];
    expectDefined(toggleMouseQuery);
    toggleMouseQuery(
      { origin: "https://example.com" },
      { tab: { url: "https://example.com/page", id: 1 } },
      vi.fn(),
    );

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        mouseSelectToQuery: expect.arrayContaining(["https://other.com", "https://example.com"]),
      }),
      expect.anything(),
    );
  });

  it("removes an already-present origin from mouseSelectToQuery", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };

    const { unit } = makeUnit({
      sendTabMessage: vi.fn(),
      browser: {
        loadRawSettings: (_keys: any, cb: any) =>
          cb({ mouseSelectToQuery: ["https://example.com"] }),
      },
    });

    const toggleMouseQuery = unit.handlers["toggleMouseQuery"];
    expectDefined(toggleMouseQuery);
    toggleMouseQuery(
      { origin: "https://example.com" },
      { tab: { url: "https://example.com/page", id: 1 } },
      vi.fn(),
    );

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({ mouseSelectToQuery: [] }),
      expect.anything(),
    );
  });

  it("skips the update when the sender has no tab", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: (_keys: any, cb: any) => cb({ mouseSelectToQuery: [] }),
      },
    });

    const toggleMouseQuery = unit.handlers["toggleMouseQuery"];
    expectDefined(toggleMouseQuery);
    // sender has no tab property
    toggleMouseQuery({ origin: "https://example.com" }, {}, vi.fn());

    expect(localSet).not.toHaveBeenCalled();
  });
});

describe("createSettings — addVIMark", () => {
  it("merges a new mark into the stored marks and persists it", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: (_keys: any, cb: any) =>
          cb({ marks: { a: { url: "https://a.example.com", scrollTop: 0 } } }),
      },
    });

    const addVIMark = unit.handlers["addVIMark"];
    expectDefined(addVIMark);
    addVIMark({ mark: { b: { url: "https://b.example.com", scrollTop: 100 } } }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        marks: expect.objectContaining({
          a: expect.anything(),
          b: { url: "https://b.example.com", scrollTop: 100 },
        }),
      }),
      expect.anything(),
    );
  });
});

describe("createSettings — jumpVIMark", () => {
  it("calls openLink when the mark's URL is not open in any tab", () => {
    g.chrome.tabs = {
      query: (_q: any, cb: (tabs: any[]) => void) => cb([{ id: 99, url: "https://other.com" }]),
    };
    const openLink = vi.fn();
    const { unit } = makeUnit({
      handlers: { openLink },
      browser: {
        loadRawSettings: (_keys: any, cb: any) =>
          cb({ marks: { x: { url: "https://target.com", scrollTop: 0, scrollLeft: 0 } } }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    jumpVIMark({ mark: "x" }, { tab: { id: 1, url: "https://current.com" } }, vi.fn());

    expect(openLink).toHaveBeenCalled();
    // The mark's tab property is set to open a new tabbed window
    const calledMarkInfo = openLink.mock.calls.at(-1)?.[0];
    expect(calledMarkInfo.tab).toEqual({ tabbed: true, active: true });
  });

  it("calls setScrollPos when the mark's tab is already the active tab", () => {
    g.chrome.tabs = {
      query: (_q: any, cb: (tabs: any[]) => void) => cb([{ id: 5, url: "https://target.com" }]),
    };
    const setScrollPos = vi.fn();
    const { unit } = makeUnit({
      setScrollPos,
      browser: {
        loadRawSettings: (_keys: any, cb: any) =>
          cb({ marks: { y: { url: "https://target.com", scrollTop: 200, scrollLeft: 0 } } }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    // The sender tab.id matches the found tab's id
    jumpVIMark({ mark: "y" }, { tab: { id: 5 } }, vi.fn());

    expect(setScrollPos).toHaveBeenCalledWith(5);
  });

  it("activates a different tab when the mark's URL is open but not focused", () => {
    const tabsUpdate = vi.fn();
    g.chrome.tabs = {
      query: (_q: any, cb: (tabs: any[]) => void) => cb([{ id: 7, url: "https://target.com" }]),
      update: tabsUpdate,
    };
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: (_keys: any, cb: any) =>
          cb({ marks: { z: { url: "https://target.com", scrollTop: 0, scrollLeft: 0 } } }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    // Sender tab.id is different from the found tab
    jumpVIMark({ mark: "z" }, { tab: { id: 99 } }, vi.fn());

    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
  });

  it("does nothing when the requested mark is not found", () => {
    const tabsQuery = vi.fn();
    g.chrome.tabs = { query: tabsQuery };
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: (_keys: any, cb: any) => cb({ marks: {} }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    jumpVIMark({ mark: "missing" }, { tab: { id: 1 } }, vi.fn());

    expect(tabsQuery).not.toHaveBeenCalled();
  });
});

describe("createSettings — resetSettings", () => {
  it("clears both storage areas and broadcasts the freshly loaded defaults", () => {
    const localClear = vi.fn();
    const syncClear = vi.fn();
    g.chrome.storage = {
      local: { set: vi.fn(), clear: localClear },
      sync: { set: vi.fn(), clear: syncClear },
    };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };

    const _response = vi.fn();
    const sendTabMessage = vi.fn();
    const { unit } = makeUnit({
      _response,
      sendTabMessage,
      browser: { loadRawSettings: (_keys: any, cb: any) => cb({ theme: "dark" }) },
    });

    const resetSettings = unit.handlers["resetSettings"];
    expectDefined(resetSettings);
    resetSettings({}, {}, vi.fn());

    expect(localClear).toHaveBeenCalled();
    expect(syncClear).toHaveBeenCalled();
    expect(_response).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ settings: expect.objectContaining({ theme: "dark" }) }),
    );
  });
});

describe("createSettings — loadSettingsFromUrl", () => {
  it("updates settings and responds with success when the fetch succeeds", async () => {
    mockRequest.mockResolvedValue(Result.succeed("LOADED_SNIPPETS"));
    const localSet = vi.fn((_d: any, cb?: () => void) => cb && cb());
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };

    const _response = vi.fn();
    const { unit } = makeUnit({ _response });

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    loadSettingsFromUrl({ url: "http://example.com/settings.js" }, {}, vi.fn());

    await vi.waitFor(() => expect(_response).toHaveBeenCalled());
    const result = _response.mock.calls.at(-1)?.[2];
    expect(result.status).toBe("Succeeded");
    expect(result.snippets).toBe("LOADED_SNIPPETS");
  });

  it("responds with failure when the URL fetch fails", async () => {
    mockRequest.mockResolvedValue(
      Result.fail(httpError("http://example.com/settings.js", new Error("net error"))),
    );
    const _response = vi.fn();
    const { unit } = makeUnit({ _response });

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    loadSettingsFromUrl({ url: "http://example.com/settings.js" }, {}, vi.fn());

    await vi.waitFor(() => expect(_response).toHaveBeenCalled());
    expect(_response.mock.calls.at(-1)?.[2].status).toBe("Failed");
  });
});

describe("createSettings — updateInputHistory", () => {
  it("replaces the history list entirely when given an array value", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };
    const _response = vi.fn();

    const { unit } = makeUnit({
      _response,
      browser: { loadRawSettings: (_keys: any, cb: any) => cb({ findHistory: ["old"] }) },
    });

    const updateInputHistory = unit.handlers["updateInputHistory"];
    expectDefined(updateInputHistory);
    updateInputHistory({ find: ["new1", "new2"] }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({ findHistory: ["new1", "new2"] }),
      expect.anything(),
    );
  });

  it("prepends a new string entry and deduplicates the history", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };
    const _response = vi.fn();

    const { unit } = makeUnit({
      _response,
      browser: {
        loadRawSettings: (_keys: any, cb: any) => cb({ cmdHistory: ["search term", "other"] }),
      },
    });

    const updateInputHistory = unit.handlers["updateInputHistory"];
    expectDefined(updateInputHistory);
    // "search term" is already in history; should be deduped and moved to front
    updateInputHistory({ cmd: "search term" }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({ cmdHistory: ["search term", "other"] }),
      expect.anything(),
    );
    // The response reports the deduplicated list
    expect(_response).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ history: ["search term", "other"] }),
    );
  });

  it("skips updating when the entry is blank or a single dot", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    const _response = vi.fn();

    const { unit } = makeUnit({
      _response,
      browser: { loadRawSettings: (_keys: any, cb: any) => cb({ findHistory: ["existing"] }) },
    });

    const updateInputHistory = unit.handlers["updateInputHistory"];
    expectDefined(updateInputHistory);
    updateInputHistory({ find: "." }, {}, vi.fn());

    // Storage should not be written for a "." entry
    expect(localSet).not.toHaveBeenCalled();
    // But the response still fires with the unchanged history
    expect(_response).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ history: ["existing"] }),
    );
  });
});

describe("createSettings — createSession", () => {
  it("records open tab URLs grouped by window and persists the session", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = {
      query: (_q: any, cb: (tabs: any[]) => void) =>
        cb([
          { id: 1, windowId: 10, index: 0, url: "https://a.com" },
          { id: 2, windowId: 10, index: 1, url: "https://b.com" },
        ]),
    };

    const { unit } = makeUnit({
      browser: { loadRawSettings: (_keys: any, cb: any) => cb({ sessions: {} }) },
    });

    const createSession = unit.handlers["createSession"];
    expectDefined(createSession);
    createSession({ name: "work", quitAfterSaved: false }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: expect.objectContaining({
          work: { tabs: [["https://a.com", "https://b.com"]] },
        }),
      }),
      expect.anything(),
    );
  });

  it("calls quit after saving when quitAfterSaved is true", () => {
    const localSet = vi.fn((_d: any, cb?: () => void) => cb && cb());
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = {
      query: (_q: any, cb: (tabs: any[]) => void) => cb([]),
    };
    const quit = vi.fn();

    const { unit } = makeUnit({
      quit,
      browser: { loadRawSettings: (_keys: any, cb: any) => cb({ sessions: {} }) },
    });

    const createSession = unit.handlers["createSession"];
    expectDefined(createSession);
    createSession({ name: "quit-session", quitAfterSaved: true }, {}, vi.fn());

    expect(quit).toHaveBeenCalled();
  });
});

describe("createSettings — deleteSession", () => {
  it("removes the named session and persists the updated sessions map", () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: (_q: any, cb: (t: any[]) => void) => cb([]) };

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: (_keys: any, cb: any) =>
          cb({ sessions: { keep: { tabs: [] }, remove: { tabs: [] } } }),
      },
    });

    const deleteSession = unit.handlers["deleteSession"];
    expectDefined(deleteSession);
    deleteSession({ name: "remove" }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: { keep: { tabs: [] } },
      }),
      expect.anything(),
    );
  });
});
