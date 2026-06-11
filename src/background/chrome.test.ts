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
});
