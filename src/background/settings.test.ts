import { Result } from "@praha/byethrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../test/helpers";
import { httpError } from "../common/result";
import type { SettingsDeps } from "./settings";
import { save, createSettings, extendObject, getSubSettings } from "./settings";

// `save` reaches the network through the request module on its local-storage
// path; mock the module so that path is observable without a real fetch.
const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));
vi.mock("./request.js", () => ({ request: mockRequest }));

type AnyChrome = { runtime?: any; storage?: any; tabs?: any; userScripts?: any; windows?: any };
const g = globalThis as unknown as { chrome: AnyChrome };
const defaultStorage = g.chrome.storage;
const defaultRuntime = g.chrome.runtime;

// A deterministic getURL so toggleBlocklist / toggleMouseQuery (which compare the
// sender URL against chrome.runtime.getURL("/")) do not depend on ambient state.
// The default setup stub returns the path verbatim, and the registerUserScript
// tests replace chrome.runtime wholesale; resetting it each test keeps every case
// starting from a known extension origin.
function stubRuntime() {
  g.chrome.runtime = {
    ...defaultRuntime,
    getURL: (path = "") => `chrome-extension://abc/${path.replace(/^\//, "")}`,
  };
}
stubRuntime();

afterEach(() => {
  g.chrome.storage = defaultStorage;
  stubRuntime();
  delete g.chrome.tabs;
  delete g.chrome.userScripts;
  delete g.chrome.windows;
  mockRequest.mockReset();
});

/** Builds a settings unit with inert defaults; override only what a test needs. */
function makeUnit(over: Partial<SettingsDeps> = {}) {
  const deps: SettingsDeps = {
    conf: {},
    browser: { loadRawSettings: vi.fn().mockResolvedValue({}) },
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

describe("save", () => {
  it("strips snippets/localPath before writing to sync storage", async () => {
    const set = vi.fn();
    const sync = { set };
    g.chrome.storage = { local: {}, sync };

    await save(sync, { localPath: "/x", snippets: "s", foo: 1, bar: 2 });

    expect(set).toHaveBeenCalledWith({ foo: 1, bar: 2 });
  });

  it("skips the sync write when only localPath/snippets were present", async () => {
    const set = vi.fn();
    const sync = { set };
    g.chrome.storage = { local: {}, sync };

    await save(sync, { localPath: "/x", snippets: "s" });

    expect(set).not.toHaveBeenCalled();
  });

  it("fetches and caches snippets from localPath before writing to local storage", async () => {
    mockRequest.mockResolvedValue(Result.succeed("FETCHED"));
    const set = vi.fn();
    const local = { set };
    g.chrome.storage = { local, sync: {} };

    await save(local, { localPath: "/snips.js", snippets: "stale" });

    expect(mockRequest).toHaveBeenCalledWith("/snips.js");
    expect(set).toHaveBeenCalledWith({ localPath: "/snips.js", snippets: "FETCHED" });
  });

  it("does not mutate the caller's data when caching snippets to local storage", async () => {
    mockRequest.mockResolvedValue(Result.succeed("FETCHED"));
    const set = vi.fn();
    const local = { set };
    g.chrome.storage = { local, sync: {} };
    const data = { localPath: "/snips.js", snippets: "stale" };

    await save(local, data);

    expect(data).toEqual({ localPath: "/snips.js", snippets: "stale" });
    expect(set).toHaveBeenCalledWith({ localPath: "/snips.js", snippets: "FETCHED" });
  });

  it("does not mutate the caller's data when stripping for sync storage", async () => {
    const set = vi.fn();
    const sync = { set };
    g.chrome.storage = { local: {}, sync };
    const data = { localPath: "/x", snippets: "s", foo: 1, bar: 2 };

    await save(sync, data);

    expect(data).toEqual({ localPath: "/x", snippets: "s", foo: 1, bar: 2 });
    expect(set).toHaveBeenCalledWith({ foo: 1, bar: 2 });
  });

  it("still writes to local storage when the snippet fetch fails", async () => {
    // A failed fetch must not strand callers: the resolved promise is what
    // `updateSettings` chains `afterSet` onto, and the `updateSettings` handler
    // ultimately settles `_response` from there, so leaving it pending hangs the
    // response forever.
    mockRequest.mockResolvedValue(Result.fail(httpError("/snips.js", new Error("404"), 404)));
    const set = vi.fn();
    const local = { set };
    g.chrome.storage = { local, sync: {} };
    const data = { localPath: "/snips.js", snippets: "stale" };

    await save(local, data);

    expect(set).toHaveBeenCalledWith({ localPath: "/snips.js" });
    // The caller's object is left intact; only the persisted copy drops snippets.
    expect(data).toEqual({ localPath: "/snips.js", snippets: "stale" });
  });

  it("still resolves when storage.set throws after a snippet fetch", async () => {
    mockRequest.mockResolvedValue(Result.succeed("FETCHED"));
    const set = vi.fn(() => {
      throw new Error("quota exceeded");
    });
    const local = { set };
    g.chrome.storage = { local, sync: {} };

    await expect(
      save(local, { localPath: "/snips.js", snippets: "stale" }),
    ).resolves.toBeUndefined();
  });
});

describe("createSettings — getState", () => {
  /** Drives the getState handler and returns the computed state string. */
  async function stateFor(
    blocklist: Record<string, number>,
    message: Record<string, unknown> = {},
    senderUrl = "https://example.com/",
  ) {
    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ blocklist }) },
    });
    const sender = { tab: { id: 1 }, url: senderUrl, frameId: 0 };
    const getState = unit.handlers["getState"];
    expectDefined(getState);
    const result = await getState(message, sender, vi.fn());
    return result?.state;
  }

  it("is disabled when the catch-all blocklist entry is set", async () => {
    expect(await stateFor({ ".*": 1 })).toBe("disabled");
  });

  it("is disabled when the sender origin is blocklisted", async () => {
    expect(await stateFor({ "https://example.com": 1 })).toBe("disabled");
  });

  it("is disabled when the url matches the blocklist pattern", async () => {
    expect(await stateFor({}, { blocklistPattern: { source: "example\\.com", flags: "" } })).toBe(
      "disabled",
    );
  });

  it("is lurking when the url matches the lurking pattern", async () => {
    expect(await stateFor({}, { lurkingPattern: { source: "example\\.com", flags: "" } })).toBe(
      "lurking",
    );
  });

  it("is enabled when nothing matches", async () => {
    expect(await stateFor({})).toBe("enabled");
  });
});

describe("createSettings — updateSettings", () => {
  it("mutates only known conf keys for the snippets scope, without broadcasting", async () => {
    const sendTabMessage = vi.fn();
    const conf: Record<string, any> = { tabsMRUOrder: true };
    const { unit } = makeUnit({ conf, sendTabMessage });

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    const result = await updateSettings(
      { scope: "snippets", settings: { tabsMRUOrder: false, unknownKey: 9 } },
      {},
      vi.fn(),
    );

    expect(conf["tabsMRUOrder"]).toBe(false);
    expect("unknownKey" in conf).toBe(false);
    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "" });
  });

  it("broadcasts the diff to every tab and persists it for a normal update", async () => {
    const sendTabMessage = vi.fn();
    const localSet = vi.fn();
    const syncSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: syncSet } };
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([{ id: 11 }, { id: 22 }]),
    };
    const { unit } = makeUnit({ sendTabMessage });

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    await updateSettings({ settings: { foo: 1 } }, {}, vi.fn());

    expect(sendTabMessage.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [11, -1],
      [22, -1],
    ]);
    expect(localSet).toHaveBeenCalled();
  });

  it("registers the user script with the snippets when saving advanced settings with a localPath", async () => {
    // The bug: save synchronously deletes snippets from the shared settings
    // object before registerUserScript reads message.settings.snippets, so the
    // snippet code was lost and the script unregistered.
    mockRequest.mockResolvedValue(Result.succeed("FETCHED"));
    const register = vi.fn();
    g.chrome.userScripts = {
      configureWorld: vi.fn(),
      getScripts: vi.fn().mockResolvedValue([]),
      register,
      unregister: vi.fn(),
    };
    g.chrome.storage = {
      local: { set: vi.fn() },
      sync: { set: vi.fn() },
    };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };
    const { unit } = makeUnit();

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    await updateSettings(
      { settings: { showAdvanced: true, localPath: "/snips.js", snippets: "SNIPPET_MARKER" } },
      {},
      vi.fn(),
    );

    expect(register).toHaveBeenCalled();
    const code = register.mock.calls.at(-1)?.[0][0].js[0].code;
    expect(code).toContain("SNIPPET_MARKER");
  });

  it("returns an error when showAdvanced is requested but userScripts API is unavailable", async () => {
    // userScripts is absent from chrome stub → isUserScriptsAvailable() returns false
    const { unit } = makeUnit();

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    const result = await updateSettings({ settings: { showAdvanced: true } }, {}, vi.fn());

    expect(result).toEqual({
      error: expect.stringContaining("Developer mode"),
    });
  });

  it("handles a rejected sync write instead of leaving it unhandled", async () => {
    // The local write succeeds and settles the response, but the fire-and-forget
    // sync write can reject (e.g. sync quota). That rejection must be caught and
    // logged rather than surfacing as an unhandled rejection that can terminate
    // the service worker.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const localSet = vi.fn().mockResolvedValue(undefined);
    const syncSet = vi.fn().mockRejectedValue(new Error("QUOTA_BYTES quota exceeded"));
    g.chrome.storage = { local: { set: localSet }, sync: { set: syncSet } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };
    const { unit } = makeUnit();

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    const result = await updateSettings({ settings: { theme: "dark" } }, {}, vi.fn());

    expect(result).toEqual({ error: "" });
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    errorSpy.mockRestore();
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
  it("resolves snippets from localPath and delivers them in the response", async () => {
    mockRequest.mockResolvedValue(Result.succeed("SNIPPET_BODY"));
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ localPath: "http://example.com/snips.js" }),
      },
    });

    const getSettings = unit.handlers["getSettings"];
    expectDefined(getSettings);
    const result = await getSettings({ key: "localPath" }, {}, vi.fn());

    expect(result.settings.snippets).toBe("SNIPPET_BODY");
  });

  it("sets an error field when the localPath fetch fails", async () => {
    mockRequest.mockResolvedValue(
      Result.fail(httpError("http://example.com/snips.js", new Error("404"), 404)),
    );
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ localPath: "http://example.com/snips.js" }),
      },
    });

    const getSettings = unit.handlers["getSettings"];
    expectDefined(getSettings);
    const result = await getSettings({ key: "localPath" }, {}, vi.fn());

    expect(result.settings.error).toMatch(/Failed to read snippets/);
  });

  it("bypasses loadSettings and uses browser.loadRawSettings directly for key=RAW", async () => {
    const loadRawSettings = vi.fn().mockResolvedValue({ raw: true });
    const { unit } = makeUnit({ browser: { loadRawSettings } });

    const getSettings = unit.handlers["getSettings"];
    expectDefined(getSettings);
    const result = await getSettings({ key: "RAW" }, {}, vi.fn());

    // loadRawSettings must have been called with the key cleared to ""
    expect(loadRawSettings).toHaveBeenCalledWith("");
    expect(result.settings).toEqual({ raw: true });
  });
});

describe("createSettings — toggleBlocklist", () => {
  function makeTabsChrome(
    localSet: (...args: unknown[]) => unknown,
    syncSet: (...args: unknown[]) => unknown,
  ) {
    g.chrome.storage = { local: { set: localSet }, sync: { set: syncSet } };
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([]),
    };
  }

  it("adds a new origin to the blocklist and returns the updated state", async () => {
    makeTabsChrome(vi.fn(), vi.fn());

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ blocklist: {} }),
      },
    });

    const toggleBlocklist = unit.handlers["toggleBlocklist"];
    expectDefined(toggleBlocklist);
    const result = await toggleBlocklist(
      {},
      {
        origin: "https://example.com",
        tab: { id: 1 },
        url: "https://example.com/page",
        frameId: 0,
      },
      vi.fn(),
    );

    expect(result).toEqual(expect.objectContaining({ blocklist: { "https://example.com": 1 } }));
  });

  it("removes an already-blocked origin from the blocklist", async () => {
    makeTabsChrome(vi.fn(), vi.fn());

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ blocklist: { "https://example.com": 1 } }),
      },
    });

    const toggleBlocklist = unit.handlers["toggleBlocklist"];
    expectDefined(toggleBlocklist);
    const result = await toggleBlocklist(
      {},
      {
        origin: "https://example.com",
        tab: { id: 1 },
        url: "https://example.com/page",
        frameId: 0,
      },
      vi.fn(),
    );

    expect(result).toEqual(expect.objectContaining({ blocklist: {} }));
  });
});

describe("createSettings — toggleMouseQuery", () => {
  it("adds a new origin to mouseSelectToQuery when it is not already present", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };
    const sendTabMessage = vi.fn();

    const { unit } = makeUnit({
      sendTabMessage,
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ mouseSelectToQuery: ["https://other.com"] }),
      },
    });

    const toggleMouseQuery = unit.handlers["toggleMouseQuery"];
    expectDefined(toggleMouseQuery);
    await toggleMouseQuery(
      { origin: "https://example.com" },
      { tab: { url: "https://example.com/page", id: 1 } },
      vi.fn(),
    );

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        mouseSelectToQuery: expect.arrayContaining(["https://other.com", "https://example.com"]),
      }),
    );
  });

  it("removes an already-present origin from mouseSelectToQuery", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const { unit } = makeUnit({
      sendTabMessage: vi.fn(),
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ mouseSelectToQuery: ["https://example.com"] }),
      },
    });

    const toggleMouseQuery = unit.handlers["toggleMouseQuery"];
    expectDefined(toggleMouseQuery);
    await toggleMouseQuery(
      { origin: "https://example.com" },
      { tab: { url: "https://example.com/page", id: 1 } },
      vi.fn(),
    );

    expect(localSet).toHaveBeenCalledWith(expect.objectContaining({ mouseSelectToQuery: [] }));
  });

  it("skips the update when the sender has no tab", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ mouseSelectToQuery: [] }),
      },
    });

    const toggleMouseQuery = unit.handlers["toggleMouseQuery"];
    expectDefined(toggleMouseQuery);
    // sender has no tab property
    await toggleMouseQuery({ origin: "https://example.com" }, {}, vi.fn());

    expect(localSet).not.toHaveBeenCalled();
  });
});

describe("createSettings — addVIMark", () => {
  it("merges a new mark into the stored marks and persists it", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi
          .fn()
          .mockResolvedValue({ marks: { a: { url: "https://a.example.com", scrollTop: 0 } } }),
      },
    });

    const addVIMark = unit.handlers["addVIMark"];
    expectDefined(addVIMark);
    await addVIMark({ mark: { b: { url: "https://b.example.com", scrollTop: 100 } } }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        marks: expect.objectContaining({
          a: expect.anything(),
          b: { url: "https://b.example.com", scrollTop: 100 },
        }),
      }),
    );
  });
});

describe("createSettings — jumpVIMark", () => {
  it("calls openLink when the mark's URL is not open in any tab", async () => {
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([{ id: 99, url: "https://other.com" }]),
    };
    const openLink = vi.fn();
    const { unit } = makeUnit({
      handlers: { openLink },
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({
          marks: { x: { url: "https://target.com", scrollTop: 0, scrollLeft: 0 } },
        }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    await jumpVIMark({ mark: "x" }, { tab: { id: 1, url: "https://current.com" } }, vi.fn());

    expect(openLink).toHaveBeenCalled();
    // The mark's tab property is set to open a new tabbed window
    const calledMarkInfo = openLink.mock.calls.at(-1)?.[0];
    expect(calledMarkInfo.tab).toEqual({ tabbed: true, active: true });
  });

  it("calls setScrollPos when the mark's tab is already the active tab", async () => {
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([{ id: 5, url: "https://target.com" }]),
    };
    const setScrollPos = vi.fn();
    const { unit } = makeUnit({
      setScrollPos,
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({
          marks: { y: { url: "https://target.com", scrollTop: 200, scrollLeft: 0 } },
        }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    // The sender tab.id matches the found tab's id
    await jumpVIMark({ mark: "y" }, { tab: { id: 5 } }, vi.fn());

    expect(setScrollPos).toHaveBeenCalledWith(5);
  });

  it("activates a different tab when the mark's URL is open but not focused", async () => {
    const tabsUpdate = vi.fn();
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([{ id: 7, url: "https://target.com" }]),
      update: tabsUpdate,
    };
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({
          marks: { z: { url: "https://target.com", scrollTop: 0, scrollLeft: 0 } },
        }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    // Sender tab.id is different from the found tab
    await jumpVIMark({ mark: "z" }, { tab: { id: 99 } }, vi.fn());

    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
  });

  it("does nothing when the requested mark is not found", async () => {
    const tabsQuery = vi.fn();
    g.chrome.tabs = { query: tabsQuery };
    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ marks: {} }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    await jumpVIMark({ mark: "missing" }, { tab: { id: 1 } }, vi.fn());

    expect(tabsQuery).not.toHaveBeenCalled();
  });
});

describe("createSettings — resetSettings", () => {
  it("clears both storage areas and broadcasts the freshly loaded defaults", async () => {
    const localClear = vi.fn();
    const syncClear = vi.fn();
    g.chrome.storage = {
      local: { set: vi.fn(), clear: localClear },
      sync: { set: vi.fn(), clear: syncClear },
    };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const sendTabMessage = vi.fn();
    const { unit } = makeUnit({
      sendTabMessage,
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ theme: "dark" }) },
    });

    const resetSettings = unit.handlers["resetSettings"];
    expectDefined(resetSettings);
    const result = await resetSettings({}, {}, vi.fn());

    expect(localClear).toHaveBeenCalled();
    expect(syncClear).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ settings: expect.objectContaining({ theme: "dark" }) }),
    );
  });

  it("waits for both storage clears to resolve before reloading defaults", async () => {
    const order: string[] = [];
    let resolveLocalClear!: () => void;
    let resolveSyncClear!: () => void;
    const localClear = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveLocalClear = () => {
            order.push("localClear");
            r();
          };
        }),
    );
    const syncClear = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveSyncClear = () => {
            order.push("syncClear");
            r();
          };
        }),
    );
    g.chrome.storage = {
      local: { set: vi.fn(), clear: localClear },
      sync: { set: vi.fn(), clear: syncClear },
    };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const loadRawSettings = vi.fn(() => {
      order.push("load");
      return Promise.resolve({ theme: "dark" });
    });
    const { unit } = makeUnit({ browser: { loadRawSettings } });

    const resetSettings = unit.handlers["resetSettings"];
    expectDefined(resetSettings);
    const handled = resetSettings({}, {}, vi.fn());

    await new Promise((r) => setTimeout(r, 0));
    expect(order).not.toContain("load");

    // Resolving only the local clear must not let the reload run; the sync clear
    // is still pending.
    resolveLocalClear();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).not.toContain("load");

    resolveSyncClear();
    await handled;
    expect(order).toEqual(["localClear", "syncClear", "load"]);
  });
});

describe("createSettings — loadSettingsFromUrl", () => {
  it("updates settings and responds with success when the fetch succeeds", async () => {
    mockRequest.mockResolvedValue(Result.succeed("LOADED_SNIPPETS"));
    g.chrome.storage = { local: { set: vi.fn() }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const { unit } = makeUnit();

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    const result = await loadSettingsFromUrl(
      { url: "http://example.com/settings.js" },
      {},
      vi.fn(),
    );

    expect(result.status).toBe("Succeeded");
    expect(result.snippets).toBe("LOADED_SNIPPETS");
  });

  it("responds with failure when the URL fetch fails", async () => {
    mockRequest.mockResolvedValue(
      Result.fail(httpError("http://example.com/settings.js", new Error("net error"))),
    );
    const { unit } = makeUnit();

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    const result = await loadSettingsFromUrl(
      { url: "http://example.com/settings.js" },
      {},
      vi.fn(),
    );

    expect(result.status).toBe("Failed");
  });
});

describe("createSettings — updateInputHistory", () => {
  it("replaces the history list entirely when given an array value", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ findHistory: ["old"] }) },
    });

    const updateInputHistory = unit.handlers["updateInputHistory"];
    expectDefined(updateInputHistory);
    await updateInputHistory({ find: ["new1", "new2"] }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({ findHistory: ["new1", "new2"] }),
    );
  });

  it("prepends a new string entry and deduplicates the history", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ cmdHistory: ["search term", "other"] }),
      },
    });

    const updateInputHistory = unit.handlers["updateInputHistory"];
    expectDefined(updateInputHistory);
    // "search term" is already in history; should be deduped and moved to front
    const result = await updateInputHistory({ cmd: "search term" }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({ cmdHistory: ["search term", "other"] }),
    );
    // The response reports the deduplicated list
    expect(result).toEqual(expect.objectContaining({ history: ["search term", "other"] }));
  });

  it("skips updating when the entry is blank or a single dot", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };

    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ findHistory: ["existing"] }) },
    });

    const updateInputHistory = unit.handlers["updateInputHistory"];
    expectDefined(updateInputHistory);
    const result = await updateInputHistory({ find: "." }, {}, vi.fn());

    // Storage should not be written for a "." entry
    expect(localSet).not.toHaveBeenCalled();
    // But the response still reports the unchanged history
    expect(result).toEqual(expect.objectContaining({ history: ["existing"] }));
  });
});

describe("createSettings — createSession", () => {
  it("records open tab URLs grouped by window and persists the session", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([
        { id: 1, windowId: 10, index: 0, url: "https://a.com" },
        { id: 2, windowId: 10, index: 1, url: "https://b.com" },
      ]),
    };

    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ sessions: {} }) },
    });

    const createSession = unit.handlers["createSession"];
    expectDefined(createSession);
    await createSession({ name: "work", quitAfterSaved: false }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: expect.objectContaining({
          work: { tabs: [["https://a.com", "https://b.com"]] },
        }),
      }),
    );
  });

  it("calls quit after saving when quitAfterSaved is true", async () => {
    g.chrome.storage = { local: { set: vi.fn() }, sync: { set: vi.fn() } };
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([]),
    };
    const quit = vi.fn();

    const { unit } = makeUnit({
      quit,
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ sessions: {} }) },
    });

    const createSession = unit.handlers["createSession"];
    expectDefined(createSession);
    await createSession({ name: "quit-session", quitAfterSaved: true }, {}, vi.fn());

    expect(quit).toHaveBeenCalled();
  });
});

describe("createSettings — deleteSession", () => {
  it("removes the named session and persists the updated sessions map", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi
          .fn()
          .mockResolvedValue({ sessions: { keep: { tabs: [] }, remove: { tabs: [] } } }),
      },
    });

    const deleteSession = unit.handlers["deleteSession"];
    expectDefined(deleteSession);
    await deleteSession({ name: "remove" }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: { keep: { tabs: [] } },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getState — url-is-null path
// ---------------------------------------------------------------------------

describe("createSettings — getState with no sender tab", () => {
  it("returns undefined when there is no sender tab (url branch skipped)", async () => {
    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ blocklist: {} }) },
    });
    const getState = unit.handlers["getState"];
    expectDefined(getState);
    // sender has no tab → the handler returns nothing
    const result = await getState({}, { url: "https://example.com/", frameId: 0 }, vi.fn());
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getSenderUrl — frame with blank URL uses tab URL
// ---------------------------------------------------------------------------

describe("createSettings — getSenderUrl via toggleBlocklist", () => {
  it("uses the tab URL when the sender frame URL is about:blank", async () => {
    g.chrome.storage = { local: { set: vi.fn() }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({ blocklist: {} }),
      },
    });

    const toggleBlocklist = unit.handlers["toggleBlocklist"];
    expectDefined(toggleBlocklist);
    // frameId !== 0 and url === "about:blank" → getSenderUrl returns tab.url
    const result = await toggleBlocklist(
      {},
      {
        frameId: 1,
        url: "about:blank",
        tab: { id: 1, url: "https://example.com/page" },
        origin: "https://example.com",
      },
      vi.fn(),
    );

    expect(result).toEqual(expect.objectContaining({ blocklist: { "https://example.com": 1 } }));
  });
});

// ---------------------------------------------------------------------------
// appendNonce — non-http URL left unchanged; URL with existing query gets &nonce
// ---------------------------------------------------------------------------

describe("createSettings — appendNonce via loadSettingsFromUrl", () => {
  it("appends ?nonce to an http URL with no existing query string", async () => {
    mockRequest.mockResolvedValue(
      Result.fail(httpError("http://example.com/settings.js", new Error("net"), 500)),
    );
    const { unit } = makeUnit();

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    await loadSettingsFromUrl({ url: "http://example.com/settings.js" }, {}, vi.fn());

    const calledUrl: string = mockRequest.mock.calls.at(-1)?.[0];
    expect(calledUrl).toMatch(/\?nonce=\d+$/);
  });

  it("appends &nonce to an http URL that already has a query string", async () => {
    mockRequest.mockResolvedValue(
      Result.fail(httpError("http://example.com/settings.js?foo=1", new Error("net"), 500)),
    );
    const { unit } = makeUnit();

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    await loadSettingsFromUrl({ url: "http://example.com/settings.js?foo=1" }, {}, vi.fn());

    const calledUrl: string = mockRequest.mock.calls.at(-1)?.[0];
    expect(calledUrl).toMatch(/&nonce=\d+$/);
  });
});

// ---------------------------------------------------------------------------
// getSettings with key === null — calls onFullSettingsRequested
// ---------------------------------------------------------------------------

describe("createSettings — getSettings with null key", () => {
  it("returns the full settings when key is null", async () => {
    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ theme: "dark" }) },
    });

    const getSettings = unit.handlers["getSettings"];
    expectDefined(getSettings);
    const result = await getSettings({ key: null }, {}, vi.fn());

    expect(result).toEqual(
      expect.objectContaining({ settings: expect.objectContaining({ theme: "dark" }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// openSession — session not found (no-op) and multi-window path
// ---------------------------------------------------------------------------

describe("createSettings — openSession", () => {
  it("does nothing when the named session does not exist", async () => {
    const tabCreate = vi.fn();
    g.chrome.tabs = {
      create: tabCreate,
      query: vi.fn().mockResolvedValue([]),
      remove: vi.fn(),
    };
    g.chrome.windows = { create: vi.fn() };

    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ sessions: {} }) },
    });

    const openSession = unit.handlers["openSession"];
    expectDefined(openSession);
    await openSession({ name: "missing" }, {}, vi.fn());

    expect(tabCreate).not.toHaveBeenCalled();
  });

  it("creates tabs in additional windows when the session has multiple window groups", async () => {
    const tabCreate = vi.fn();
    const windowCreate = vi.fn().mockResolvedValue({ id: 99 });
    const tabRemove = vi.fn();
    g.chrome.tabs = {
      create: tabCreate,
      query: vi.fn().mockResolvedValue([]),
      remove: tabRemove,
    };
    g.chrome.windows = { create: windowCreate };

    const { unit } = makeUnit({
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({
          sessions: {
            work: {
              tabs: [
                ["https://a.com", "https://b.com"], // window 1
                ["https://c.com"], // window 2
              ],
            },
          },
        }),
      },
    });

    const openSession = unit.handlers["openSession"];
    expectDefined(openSession);
    await openSession({ name: "work" }, {}, vi.fn());

    // First window tabs are created directly (no callback)
    expect(tabCreate).toHaveBeenCalledWith(expect.objectContaining({ url: "https://a.com" }));
    expect(tabCreate).toHaveBeenCalledWith(expect.objectContaining({ url: "https://b.com" }));
    // Second window: windowCreate is called and then a tab is created in it
    expect(windowCreate).toHaveBeenCalled();
    expect(tabCreate).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://c.com", windowId: 99 }),
    );
  });
});

// ---------------------------------------------------------------------------
// createSession — tab whose URL equals newTabUrl is excluded
// ---------------------------------------------------------------------------

describe("createSettings — createSession excludes newTab URLs", () => {
  it("omits tabs whose URL matches newTabUrl from the saved session", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([
        { id: 1, windowId: 10, index: 0, url: "https://a.com" },
        { id: 2, windowId: 10, index: 1, url: "about:newtab" }, // should be excluded
      ]),
    };

    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ sessions: {} }) },
    });

    const createSession = unit.handlers["createSession"];
    expectDefined(createSession);
    await createSession({ name: "filtered", quitAfterSaved: false }, {}, vi.fn());

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: expect.objectContaining({
          filtered: { tabs: [["https://a.com"]] },
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// registerUserScript — existing script with same code skips re-register
// ---------------------------------------------------------------------------

describe("createSettings — registerUserScript branch: existing script same code", () => {
  it("does not re-register when the stored script code is identical", async () => {
    mockRequest.mockResolvedValue(Result.succeed("LOADED_SNIPPETS"));
    const register = vi.fn();
    const unregister = vi.fn();
    // Build the expected code so we can put it in the stub
    const snippets = "LOADED_SNIPPETS";
    const codeBuilt = `import('./api.js').then((module) => {module.default("chrome-extension://abc/", (api, settings) => {${snippets}\n})});`;
    g.chrome.userScripts = {
      configureWorld: vi.fn(),
      getScripts: vi.fn().mockResolvedValue([{ js: [{ code: codeBuilt }] }]),
      register,
      unregister,
    };
    g.chrome.storage = { local: { set: vi.fn() }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };
    g.chrome.runtime = {
      ...g.chrome.runtime,
      getManifest: () => ({ manifest_version: 2 }),
      getURL: () => "chrome-extension://abc/",
    };

    const { unit } = makeUnit();

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    await loadSettingsFromUrl({ url: "http://example.com/settings.js" }, {}, vi.fn());

    // register should NOT be called because the code is already identical
    expect(register).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// toggleMouseQuery — sender tab URL starts with chrome.runtime.getURL (skipped)
// ---------------------------------------------------------------------------

describe("createSettings — toggleMouseQuery skips extension pages", () => {
  it("does not update mouseSelectToQuery when the sender tab URL is the extension itself", async () => {
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };

    const { unit } = makeUnit({
      browser: { loadRawSettings: vi.fn().mockResolvedValue({ mouseSelectToQuery: [] }) },
    });

    const toggleMouseQuery = unit.handlers["toggleMouseQuery"];
    expectDefined(toggleMouseQuery);
    // The tab URL begins with chrome.runtime.getURL("/") which is "chrome-extension://..."
    const extUrl = g.chrome.runtime?.getURL?.("/") ?? "chrome-extension://abc/";
    await toggleMouseQuery(
      { origin: "https://example.com" },
      { tab: { url: extUrl + "frontend.html", id: 1 } },
      vi.fn(),
    );

    expect(localSet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// jumpVIMark — scrollLeft/scrollTop stored in tabMessages when tab differs
// ---------------------------------------------------------------------------

describe("createSettings — jumpVIMark stores scroll position for other tab", () => {
  it("stores scroll position in tabMessages when the mark tab differs from the sender", async () => {
    const tabsUpdate = vi.fn();
    g.chrome.tabs = {
      query: vi.fn().mockResolvedValue([{ id: 7, url: "https://target.com" }]),
      update: tabsUpdate,
    };
    const tabMessages: Record<string, any> = {};
    const { unit } = makeUnit({
      tabMessages,
      browser: {
        loadRawSettings: vi.fn().mockResolvedValue({
          marks: { q: { url: "https://target.com", scrollTop: 300, scrollLeft: 50 } },
        }),
      },
    });

    const jumpVIMark = unit.handlers["jumpVIMark"];
    expectDefined(jumpVIMark);
    await jumpVIMark({ mark: "q" }, { tab: { id: 99 } }, vi.fn());

    expect(tabMessages[7]).toEqual({ scrollLeft: 50, scrollTop: 300 });
    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
  });
});

// ---------------------------------------------------------------------------
// updateSettings — non-showAdvanced path updates settings without userScripts
// ---------------------------------------------------------------------------

describe("createSettings — updateSettings non-showAdvanced path", () => {
  it("broadcasts and persists settings when showAdvanced is false", async () => {
    const sendTabMessage = vi.fn();
    const localSet = vi.fn();
    g.chrome.storage = { local: { set: localSet }, sync: { set: vi.fn() } };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([{ id: 5 }]) };

    const { unit } = makeUnit({ sendTabMessage });

    const updateSettings = unit.handlers["updateSettings"];
    expectDefined(updateSettings);
    const result = await updateSettings(
      { settings: { showAdvanced: false, theme: "dark" } },
      {},
      vi.fn(),
    );

    expect(sendTabMessage).toHaveBeenCalledWith(
      5,
      -1,
      expect.objectContaining({ subject: "settingsUpdated" }),
    );
    expect(localSet).toHaveBeenCalled();
    expect(result).toEqual({ error: "" });
  });
});

describe("createSettings — appendNonce leaves a non-http URL unchanged", () => {
  it("requests a file:// settings URL verbatim (the /^https?:/ guard is false)", async () => {
    mockRequest.mockResolvedValue(
      Result.fail(httpError("file:///settings.js", new Error("net"), 0)),
    );
    const { unit } = makeUnit();

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    await loadSettingsFromUrl({ url: "file:///settings.js" }, {}, vi.fn());

    // No nonce is appended for a non-http(s) URL.
    expect(mockRequest).toHaveBeenCalledWith("file:///settings.js");
  });
});

describe("createSettings — registerUserScript register/unregister branches", () => {
  function chromeWithUserScripts(getScripts: (...args: unknown[]) => unknown) {
    const register = vi.fn();
    const unregister = vi.fn();
    g.chrome.userScripts = { configureWorld: vi.fn(), getScripts, register, unregister };
    g.chrome.storage = {
      local: { set: vi.fn() },
      sync: { set: vi.fn() },
    };
    g.chrome.tabs = { query: vi.fn().mockResolvedValue([]) };
    g.chrome.runtime = {
      ...g.chrome.runtime,
      getManifest: () => ({ manifest_version: 2 }),
      getURL: () => "chrome-extension://abc/",
    };
    return { register, unregister };
  }

  it("unregisters then re-registers when the stored script code differs", async () => {
    // getScripts returns a script whose code does not match the freshly built one.
    const { register, unregister } = chromeWithUserScripts(
      vi.fn().mockResolvedValue([{ js: [{ code: "/* stale code */" }] }]),
    );
    const { unit } = makeUnit();

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    mockRequest.mockResolvedValue(Result.succeed("NEW_SNIPPETS"));
    await loadSettingsFromUrl({ url: "http://example.com/settings.js" }, {}, vi.fn());

    expect(unregister).toHaveBeenCalledWith({ ids: ["settingsSnippets"] });
    expect(register).toHaveBeenCalledOnce();
  });

  it("registers directly without unregistering when no script is stored yet", async () => {
    const { register, unregister } = chromeWithUserScripts(vi.fn().mockResolvedValue([]));
    const { unit } = makeUnit();

    const loadSettingsFromUrl = unit.handlers["loadSettingsFromUrl"];
    expectDefined(loadSettingsFromUrl);
    mockRequest.mockResolvedValue(Result.succeed("FRESH_SNIPPETS"));
    await loadSettingsFromUrl({ url: "http://example.com/settings.js" }, {}, vi.fn());

    expect(register).toHaveBeenCalledOnce();
    expect(unregister).not.toHaveBeenCalled();
  });
});
