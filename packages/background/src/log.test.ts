import { stubStorageGet } from "@sk/test-support/helpers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOG } from "./log";

let restoreStorage: (() => void) | undefined;

afterEach(() => {
  restoreStorage?.();
  restoreStorage = undefined;
  vi.restoreAllMocks();
});

describe("LOG", () => {
  it("takes its enabled levels from the logLevels key of local storage", async () => {
    restoreStorage = stubStorageGet({ logLevels: ["log"] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    LOG("log", "chatter");

    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("chatter"));
    expect(vi.mocked(chrome.storage.local.get)).toHaveBeenCalledWith(["logLevels"]);
  });

  it("falls back to error only when the storage read yields no result object at all", async () => {
    restoreStorage = stubStorageGet(undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    LOG("error", "boom");

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("boom"));
  });
});
