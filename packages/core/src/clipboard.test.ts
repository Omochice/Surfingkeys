import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineEnv } from "./engineEnv";

vi.mock("./utils", () => ({
  getBrowserName: vi.fn(() => "Chrome"),
  actionWithSelectionPreserved: vi.fn((cb: (s: Selection | null) => void) => cb(null)),
  setSanitizedContent: vi.fn(),
  showBanner: vi.fn(),
}));

// markAutoFocus is called at module-init time inside createClipboard.
vi.mock("./domFlags", () => ({
  markAutoFocus: vi.fn(),
}));

import createClipboard from "./clipboard";
import { getBrowserName, showBanner } from "./utils";

const mockGetBrowserName = vi.mocked(getBrowserName);
const mockShowBanner = vi.mocked(showBanner);
const mockNotify = vi.fn();

const makeEnv = (): EngineEnv => ({
  notify: mockNotify,
  isInUIFrame: () => false,
  reportIssue: () => {},
  tabOpenLink: () => {},
  getExtensionURL: (path: string) => path,
  log: () => {},
  surfingkeys: undefined,
});

describe("Clipboard.write on Chrome", () => {
  beforeEach(() => {
    mockGetBrowserName.mockReturnValue("Chrome");
    mockShowBanner.mockClear();
    mockNotify.mockClear();
    // jsdom does not implement execCommand; define it so spyOn can override it.
    if (!document.execCommand) {
      Object.defineProperty(document, "execCommand", {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a banner with the copied text", () => {
    const clipboard = createClipboard(makeEnv());
    clipboard.write("hello world");
    expect(mockShowBanner).toHaveBeenCalledWith("Copied: hello world");
  });

  it("does not call notify for Chrome (uses execCommand path)", () => {
    const clipboard = createClipboard(makeEnv());
    clipboard.write("some text");
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("Clipboard.write on Firefox", () => {
  beforeEach(() => {
    mockGetBrowserName.mockReturnValue("Firefox");
    mockShowBanner.mockClear();
    mockNotify.mockClear();
  });

  it("calls notify('writeClipboard') with the text", () => {
    const clipboard = createClipboard(makeEnv());
    clipboard.write("firefox text");
    expect(mockNotify).toHaveBeenCalledWith("writeClipboard", { text: "firefox text" });
  });

  it("still shows a banner after notify call", () => {
    const clipboard = createClipboard(makeEnv());
    clipboard.write("firefox text");
    expect(mockShowBanner).toHaveBeenCalledWith("Copied: firefox text");
  });
});

describe("Clipboard.read on Chrome (execCommand path)", () => {
  beforeEach(() => {
    mockGetBrowserName.mockReturnValue("Chrome");
    // jsdom does not implement execCommand; define it so spyOn can override it.
    if (!document.execCommand) {
      Object.defineProperty(document, "execCommand", {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers clipboard text synchronously via the onReady callback", () => {
    const clipboard = createClipboard(makeEnv());

    // jsdom has no clipboard behind execCommand, so the paste is simulated by
    // writing into the holder the production code created.
    const execCommandSpy = vi.spyOn(document, "execCommand").mockImplementation((cmd) => {
      if (cmd === "paste") {
        const holder = document.getElementById("sk_clipboard") as HTMLTextAreaElement | null;
        if (holder) {
          holder.value = "pasted content";
        }
      }
      return true;
    });

    let received: string | undefined;
    clipboard.read((response) => {
      received = response.data;
    });

    expect(received).toBe("pasted content");
    execCommandSpy.mockRestore();
  });

  it("falls back to innerHTML when holder.value is empty after paste", () => {
    const clipboard = createClipboard(makeEnv());

    // jsdom escapes raw HTML assigned to a textarea's innerHTML, so the getter is
    // overridden instead.
    const execCommandSpy = vi.spyOn(document, "execCommand").mockImplementation((cmd) => {
      if (cmd === "paste") {
        const holder = document.getElementById("sk_clipboard") as HTMLTextAreaElement | null;
        if (holder) {
          holder.value = "";
          Object.defineProperty(holder, "innerHTML", {
            get: () => "lineA<br>lineB",
            configurable: true,
          });
        }
      }
      return true;
    });

    let received: string | undefined;
    clipboard.read((response) => {
      received = response.data;
    });

    expect(received).toBe("lineA\nlineB");
    execCommandSpy.mockRestore();
  });
});

describe("Clipboard.read on Firefox (navigator.clipboard path)", () => {
  it("reads from navigator.clipboard.readText and delivers via callback after timeout", async () => {
    mockGetBrowserName.mockReturnValue("Firefox");

    const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: vi.fn().mockResolvedValue("clipboard text"),
      },
      configurable: true,
      writable: true,
    });

    try {
      const clipboard = createClipboard(makeEnv());

      let received: string | undefined;
      clipboard.read((response) => {
        received = response.data;
      });

      // The Firefox path delivers the result from a setTimeout callback.
      vi.useFakeTimers();
      await Promise.resolve(); // let the readText promise resolve
      vi.runAllTimers();
      vi.useRealTimers();

      expect(received).toBe("clipboard text");
    } finally {
      vi.useRealTimers();
      if (origClipboard) {
        Object.defineProperty(navigator, "clipboard", origClipboard);
      } else {
        // @ts-expect-error -- restoring stub
        delete navigator.clipboard;
      }
      mockGetBrowserName.mockReturnValue("Chrome");
    }
  });
});
