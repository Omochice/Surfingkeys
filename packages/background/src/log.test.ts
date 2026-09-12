import { afterEach, describe, expect, it, vi } from "vitest";

import { addLogSink, LOG } from "./log";

type StorageGet = (keys: string[], cb: (items: any) => void) => void;
const g = globalThis as unknown as { chrome: { storage: { local: { get: StorageGet } } } };
const defaultGet = g.chrome.storage.local.get;

// The gate is decided behind an asynchronous storage read, so assertions must let pending
// continuations run before inspecting the sinks.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Answer every storage read with the given stored result. */
function stubStorage(items: unknown): void {
  g.chrome.storage.local.get = vi.fn((_keys: string[], cb: (items: any) => void) => cb(items));
}

afterEach(() => {
  g.chrome.storage.local.get = defaultGet;
  vi.restoreAllMocks();
});

describe("LOG", () => {
  it("writes an error record to the console when nothing is stored under logLevels", async () => {
    stubStorage({});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    LOG("error", "boom");

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("boom"));
  });
});

describe("addLogSink", () => {
  it("delivers enabled records to a sink attached after the logger was built", async () => {
    stubStorage({ logLevels: ["error"] });
    const sink = vi.fn();
    const remove = addLogSink(sink);

    LOG("error", "boom");

    await vi.waitFor(() => expect(sink).toHaveBeenCalledExactlyOnceWith("error", "boom"));
    remove();
  });

  it("stops delivering once the returned disposer has run", async () => {
    stubStorage({ logLevels: ["error"] });
    const sink = vi.fn();
    const remove = addLogSink(sink);

    remove();
    LOG("error", "boom");
    await flush();

    expect(sink).not.toHaveBeenCalled();
  });
});
