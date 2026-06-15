import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the runtime module so RUNTIME is a spy we can inspect.
vi.mock("./runtime", () => {
  const RUNTIME = vi.fn(() => ({ ok: true })) as any;
  RUNTIME.repeats = 1;
  return { RUNTIME, runtime: { conf: {} } };
});

// Mock utils so we can control getBrowserName and capture showBanner calls.
vi.mock("./utils", () => ({
  getBrowserName: vi.fn(() => "Chrome"),
  actionWithSelectionPreserved: vi.fn((cb: (s: Selection | null) => void) => cb(null)),
  setSanitizedContent: vi.fn(),
  showBanner: vi.fn(),
}));

// Mock domFlags — markAutoFocus is called at module-init time inside createClipboard.
vi.mock("./domFlags", () => ({
  markAutoFocus: vi.fn(),
}));

import createClipboard from "./clipboard";
import { RUNTIME } from "./runtime";
import { getBrowserName, showBanner } from "./utils";

const mockGetBrowserName = vi.mocked(getBrowserName);
const mockShowBanner = vi.mocked(showBanner);
const mockRUNTIME = vi.mocked(RUNTIME as any);

describe("Clipboard.write on Chrome", () => {
  beforeEach(() => {
    mockGetBrowserName.mockReturnValue("Chrome");
    mockShowBanner.mockClear();
    mockRUNTIME.mockClear();
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
    const clipboard = createClipboard();
    clipboard.write("hello world");
    expect(mockShowBanner).toHaveBeenCalledWith("Copied: hello world");
  });

  it("does not call RUNTIME for Chrome (uses execCommand path)", () => {
    const clipboard = createClipboard();
    clipboard.write("some text");
    expect(mockRUNTIME).not.toHaveBeenCalled();
  });
});

describe("Clipboard.write on Firefox", () => {
  beforeEach(() => {
    mockGetBrowserName.mockReturnValue("Firefox");
    mockShowBanner.mockClear();
    mockRUNTIME.mockClear();
  });

  it("calls RUNTIME('writeClipboard') with the text", () => {
    const clipboard = createClipboard();
    clipboard.write("firefox text");
    expect(mockRUNTIME).toHaveBeenCalledWith("writeClipboard", { text: "firefox text" });
  });

  it("still shows a banner after RUNTIME call", () => {
    const clipboard = createClipboard();
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
    const clipboard = createClipboard();

    // Simulate the browser pasting text into the holder by intercepting
    // document.execCommand.  After execCommand("paste") the holder's value
    // should contain the pasted text.
    const execCommandSpy = vi.spyOn(document, "execCommand").mockImplementation((cmd) => {
      if (cmd === "paste") {
        // The holder textarea is appended to documentElement during the action;
        // we can find it by id.
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
    const clipboard = createClipboard();

    // jsdom treats textarea innerHTML as escaped text, so we use a <div>
    // replacement strategy: override the property on the holder element directly
    // by finding it after it is appended to the DOM.
    const execCommandSpy = vi.spyOn(document, "execCommand").mockImplementation((cmd) => {
      if (cmd === "paste") {
        const holder = document.getElementById("sk_clipboard") as HTMLTextAreaElement | null;
        if (holder) {
          holder.value = "";
          // Directly define innerHTML to return a string with <br> tags, since
          // jsdom escapes raw HTML set on textarea innerHTML.
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

    // Stub navigator.clipboard.readText
    const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: vi.fn().mockResolvedValue("clipboard text"),
      },
      configurable: true,
      writable: true,
    });

    try {
      const clipboard = createClipboard();

      let received: string | undefined;
      clipboard.read((response) => {
        received = response.data;
      });

      // The Firefox path calls setTimeout to deliver the result asynchronously;
      // advance fake timers to trigger the callback.
      vi.useFakeTimers();
      await Promise.resolve(); // let the readText promise resolve
      vi.runAllTimers();
      vi.useRealTimers();

      expect(received).toBe("clipboard text");
    } finally {
      // Always restore the stubbed navigator.clipboard, real timers, and the
      // browser-name mock, even if the assertion above throws.
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
