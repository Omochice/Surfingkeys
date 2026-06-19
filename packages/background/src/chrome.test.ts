import { afterEach, describe, expect, it, vi } from "vitest";

import { chromeSpecifics } from "./chrome";

const g = globalThis as unknown as { chrome: any };
const realChrome = g.chrome;

afterEach(() => {
  g.chrome = realChrome;
});

describe("chromeSpecifics.loadRawSettings", () => {
  it("degrades gracefully when the sync write fails instead of rejecting", async () => {
    // Local is newer than sync, so settings are mirrored back to sync. In MV3 the
    // promise-based storage API rejects on failure (it does not set
    // chrome.runtime.lastError), so a sync-quota error must be caught and surfaced
    // as `error` on the returned settings rather than rejecting the whole load.
    g.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ savedAt: 2, theme: "dark" }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        sync: {
          get: vi.fn().mockResolvedValue({ savedAt: 1 }),
          set: vi.fn().mockRejectedValue(new Error("QUOTA_BYTES quota exceeded")),
        },
      },
      runtime: {},
    };

    const result = await chromeSpecifics.loadRawSettings(["theme"]);

    expect(result["theme"]).toBe("dark");
    expect(result["error"]).toMatch(/Settings sync may not work/);
  });

  it("does not produce an unhandled rejection when the local write after a sync-wins merge fails", async () => {
    // Sync is newer than local, so the sync data is written back to local storage
    // (to keep local as a cached copy). The local.set call is fire-and-forget with
    // `void`, so a rejection there becomes an unhandled rejection that can terminate
    // the MV3 service worker. The fix must catch that rejection and log it instead.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    g.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ savedAt: 1, theme: "light" }),
          set: vi.fn().mockRejectedValue(new Error("QUOTA_BYTES_PER_ITEM quota exceeded")),
        },
        sync: {
          get: vi.fn().mockResolvedValue({ savedAt: 2, theme: "dark" }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {},
    };

    const result = await chromeSpecifics.loadRawSettings(["theme"]);

    // The load must complete successfully with the sync-sourced value.
    expect(result["theme"]).toBe("dark");
    // The local write failure must be caught and logged, not left unhandled.
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    errorSpy.mockRestore();
  });
});
