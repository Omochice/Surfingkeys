import { LOG } from "@sk/adapter/log";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sk/adapter/log", () => ({ LOG: vi.fn() }));

const mockLOG = vi.mocked(LOG);

import { logSnippetLifecycle } from "./snippetLifecycle";

beforeEach(() => {
  mockLOG.mockReset();
});

describe("logSnippetLifecycle", () => {
  it("emits the milestone under a fixed prefix at log level", () => {
    logSnippetLifecycle("userScriptReadyReceived", {});

    expect(mockLOG).toHaveBeenCalledWith(
      "log",
      "snippet-lifecycle",
      "userScriptReadyReceived",
      expect.any(Object),
    );
  });

  it("tags every record with the frame it was emitted from", () => {
    logSnippetLifecycle("userSettingsApplied", {});

    expect(mockLOG.mock.calls[0]?.[3]).toEqual({
      top: window === top,
      href: window.location.href,
    });
  });

  it("keeps the frame tags when the details carry the same names", () => {
    logSnippetLifecycle("settingsFetchFailed", { top: "detail", href: "detail" });

    expect(mockLOG.mock.calls[0]?.[3]).toEqual({
      top: window === top,
      href: window.location.href,
    });
  });

  it("passes the given details through", () => {
    logSnippetLifecycle("runUserScriptRequested", { trigger: "initial" });

    expect(mockLOG.mock.calls[0]?.[3]).toMatchObject({ trigger: "initial" });
  });
});
