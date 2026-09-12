import { afterEach, describe, expect, it, vi } from "vitest";

import { LOG } from "./log";

type StorageGet = (keys: string[], cb: (items: any) => void) => void;
const g = globalThis as unknown as { chrome: { storage: { local: { get: StorageGet } } } };
const defaultGet = g.chrome.storage.local.get;

// The gate is decided behind an asynchronous storage read, so assertions must let
// pending continuations run before inspecting the console spies.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Answer every storage read with the given stored result. */
function stubStorage(items: unknown): ReturnType<typeof vi.fn> {
  const get = vi.fn((_keys: string[], cb: (items: any) => void) => cb(items));
  g.chrome.storage.local.get = get;
  return get;
}

afterEach(() => {
  g.chrome.storage.local.get = defaultGet;
  vi.restoreAllMocks();
});

describe("LOG", () => {
  it("logs error when nothing is stored under logLevels", async () => {
    stubStorage({});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    LOG("error", "boom");

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("boom"));
  });

  it("drops log and warn when nothing is stored under logLevels", async () => {
    stubStorage({});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    LOG("log", "chatter");
    LOG("warn", "caution");
    await flush();

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs error when the storage read yields no result object at all", async () => {
    stubStorage(undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    LOG("error", "boom");

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("boom"));
  });

  it("logs the levels listed in a stored logLevels array", async () => {
    stubStorage({ logLevels: ["log", "warn"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    LOG("log", "chatter");
    LOG("warn", "caution");

    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledWith("chatter");
      expect(warn).toHaveBeenCalledWith("caution");
    });
  });

  it("drops levels absent from a stored logLevels array", async () => {
    stubStorage({ logLevels: ["log"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    LOG("error", "boom");
    await flush();

    expect(error).not.toHaveBeenCalled();
  });

  it("falls back to error only when the stored logLevels is not an array", async () => {
    stubStorage({ logLevels: "log" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    LOG("log", "chatter");
    LOG("error", "boom");

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("boom"));
    expect(log).not.toHaveBeenCalled();
  });

  it("passes the message to the console method as its only argument", async () => {
    stubStorage({ logLevels: ["log"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const msg = { detail: 1 };

    LOG("log", msg);

    await vi.waitFor(() => expect(log).toHaveBeenCalledExactlyOnceWith(msg));
  });

  it("re-reads logLevels on every call so a stored change takes effect immediately", async () => {
    let stored: unknown = [];
    const get = vi.fn((_keys: string[], cb: (items: any) => void) => cb({ logLevels: stored }));
    g.chrome.storage.local.get = get;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    LOG("log", "before");
    await flush();
    expect(log).not.toHaveBeenCalled();

    stored = ["log"];
    LOG("log", "after");

    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("after"));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
