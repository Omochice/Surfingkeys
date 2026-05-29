import { afterEach, describe, expect, it, vi } from "vitest";

import type { SettingsDeps } from "./settings";
import { _save, createSettings, getSubSettings } from "./settings";

// `_save` reaches the network through the request module on its local-storage
// path; mock the module so that path is observable without a real fetch.
const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));
vi.mock("./request.js", () => ({ request: mockRequest }));

type AnyChrome = { runtime?: any; storage?: any; tabs?: any };
const g = globalThis as unknown as { chrome: AnyChrome };
const defaultStorage = g.chrome.storage;

afterEach(() => {
  g.chrome.storage = defaultStorage;
  delete g.chrome.tabs;
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

  it("fetches and caches snippets from localPath before writing to local storage", () => {
    mockRequest.mockImplementation((_url: string, onReady: (c: string) => void) =>
      onReady("FETCHED"),
    );
    const set = vi.fn();
    const local = { set };
    g.chrome.storage = { local, sync: {} };

    _save(local, { localPath: "/snips.js", snippets: "stale" });

    expect(mockRequest).toHaveBeenCalledWith("/snips.js", expect.any(Function));
    expect(set).toHaveBeenCalledWith({ localPath: "/snips.js", snippets: "FETCHED" }, undefined);
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
    unit.handlers.getState!(message, sender, vi.fn());
    return _response.mock.calls[_response.mock.calls.length - 1][2].state;
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

    const result = unit.handlers.updateSettings!(
      { scope: "snippets", settings: { tabsMRUOrder: false, unknownKey: 9 } },
      {},
      vi.fn(),
    );

    expect(conf.tabsMRUOrder).toBe(false);
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

    unit.handlers.updateSettings!({ settings: { foo: 1 } }, {}, vi.fn());

    expect(sendTabMessage.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [11, -1],
      [22, -1],
    ]);
    expect(localSet).toHaveBeenCalled();
  });
});
