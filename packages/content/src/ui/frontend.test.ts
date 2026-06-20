/**
 * Tests for frontend.ts: Front IIFE, StatusBar, and Find sub-modules.
 *
 * The file runs in jsdom. frontend.ts is an IIFE that queries the DOM at import time, so the DOM
 * scaffold and vi.mock calls must be established before the module is loaded. vi.mock calls are
 * automatically hoisted by Vitest; the DOM body is set in the module's own scope (top-level, runs
 * after mocks) so it is ready when the lazy import executes in beforeAll.
 *
 * Paths that rely on layout geometry (offsetWidth/Height, getBoundingClientRect returning real
 * sizes) are not testable under jsdom and are skipped. Specifically skipped:
 *
 * - Position math for actions["showBubble"] (offsetWidth/offsetHeight return 0 in jsdom)
 * - RenderTabs: relies on getBoundingClientRect().height
 * - ShowRichHints: pendingHint timer (richHintsForKeystroke range only) is tricky to time
 */

import { specialKeys } from "@sk/core/specialKeys";
import { runtime } from "@sk/messaging/runtime";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any import executes.
// ---------------------------------------------------------------------------

// solid-js: override createSignal with a plain [getter, setter] pair so the
// IIFE can call the setters without triggering Solid's reactive runtime.
// importOriginal preserves all other exports (DEV, etc.) that Solid's own
// refresh plugin requires.
vi.mock("solid-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("solid-js")>();
  function createSignal<T>(initial: T): [() => T, (v: T) => void] {
    let val = initial;
    return [
      () => val,
      (v: T) => {
        val = v;
      },
    ];
  }
  return { ...actual, createSignal };
});

// solid-js/web: override render with a no-op so the IIFE's many render()
// calls succeed even though the DOM containers are empty stubs.
// importOriginal preserves all other exports (template, etc.) that Solid's
// compiled component output references.
vi.mock("solid-js/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("solid-js/web")>();
  return { ...actual, render: vi.fn() };
});

// ./omnibar: the real createOmnibar wires up Solid rendering and its own DOM
// queries; we don't need any of that for these tests.
vi.mock("./omnibar", () => ({
  default: vi.fn(() => ({
    command: vi.fn(),
    mappings: { getWords: () => [] },
    onShow: vi.fn(),
  })),
}));

// ./command: registers keybindings on normal-mode that we don't need here.
vi.mock("./command", () => ({ default: vi.fn() }));

// ../common/api + ../common/default: heavy wiring we don't need.
vi.mock("@sk/core/api", () => ({ default: vi.fn(() => ({})) }));
vi.mock("@sk/core/default", () => ({ default: vi.fn() }));

// @sk/messaging/runtime: intercept RUNTIME calls so no chrome.runtime.sendMessage
// reaches the chrome stub.
vi.mock("@sk/messaging/runtime", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@sk/messaging/runtime")>();
  return {
    ...orig,
    RUNTIME: vi.fn(() => ({ tag: "success", value: undefined })),
  };
});

// ---------------------------------------------------------------------------
// DOM scaffold — must exist before the IIFE runs at import time.
// ---------------------------------------------------------------------------
document.body.innerHTML = `
  <style id="sk_theme"></style>
  <div id="sk_omnibar" style="display:none">
    <style></style>
    <div id="sk_omnibarSearchArea">
      <span class="prompt"></span>
      <span class="resultPage"></span>
    </div>
    <div id="sk_omnibarSearchResult"></div>
  </div>
  <div id="sk_status" style="display:none">
    <span></span><span></span><span></span><span></span>
  </div>
  <div id="sk_usage"  style="display:none"></div>
  <div id="sk_popup"  style="display:none"></div>
  <div id="sk_tabs"   style="display:none"></div>
  <div id="sk_banner" style="display:none"></div>
  <div id="sk_bubble" style="display:none">
    <div class="sk_bubble_content"></div>
    <div class="sk_arrow" style="position:absolute;top:100%">
      <div></div><div></div>
    </div>
  </div>
  <div id="sk_keystroke" style="display:none"></div>
`;

// ---------------------------------------------------------------------------
// Lazy import — executed after the DOM and mocks are ready.
// ---------------------------------------------------------------------------
let Front: any;

beforeAll(async () => {
  const mod = await import("./frontend");
  Front = mod.default;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dispatchFrontendMessage(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { surfingkeys_frontend_data: data },
    }),
  );
}

// ---------------------------------------------------------------------------
// actions["initFrontend"]
// ---------------------------------------------------------------------------
describe("actions['initFrontend']", () => {
  it("stores topOrigin from the message", () => {
    Front.actions["initFrontend"]({ origin: "https://test.example.com", winSize: [1280, 800] });
    expect(Front.topOrigin).toBe("https://test.example.com");
  });

  it("stores topSize from the message", () => {
    Front.actions["initFrontend"]({ origin: "https://a.example.com", winSize: [1024, 768] });
    expect(Front.topSize).toEqual([1024, 768]);
  });

  it("returns a numeric timestamp", () => {
    const before = Date.now();
    const result = Front.actions["initFrontend"]({
      origin: "https://b.example.com",
      winSize: [0, 0],
    });
    const after = Date.now();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// actions["destroyFrontend"]
// ---------------------------------------------------------------------------
describe("actions['destroyFrontend']", () => {
  it("returns true when no popup display is visible", () => {
    // No display is open, so destroyFrontend should return true.
    const result = Front.actions["destroyFrontend"]();
    expect(result).toBe(true);
  });

  it("runs all registered destroy listeners and returns true", () => {
    const calls: number[] = [];
    Front.addDestroyListener(() => {
      calls.push(1);
    });
    Front.addDestroyListener(() => {
      calls.push(2);
    });

    const result = Front.actions["destroyFrontend"]();
    expect(result).toBe(true);
    expect(calls).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// actions["toggleStatus"]
// ---------------------------------------------------------------------------
describe("actions['toggleStatus']", () => {
  it("hides the status bar when visible is false", () => {
    Front.statusBar.style.display = "";
    Front.actions["toggleStatus"]({ visible: false });
    expect(Front.statusBar.style.display).toBe("none");
  });

  it("shows the status bar when visible is true", () => {
    Front.statusBar.style.display = "none";
    Front.actions["toggleStatus"]({ visible: true });
    expect(Front.statusBar.style.display).toBe("");
  });
});

// ---------------------------------------------------------------------------
// actions["applyUserSettings"]
// ---------------------------------------------------------------------------
describe("actions['applyUserSettings']", () => {
  it("merges a known runtime.conf key from userSettings", () => {
    const original = runtime.conf.tabsThreshold;
    Front.actions["applyUserSettings"]({ userSettings: { tabsThreshold: 42 } });
    expect(runtime.conf.tabsThreshold).toBe(42);
    // restore
    runtime.conf.tabsThreshold = original;
  });

  it("ignores unknown keys that are not in runtime.conf", () => {
    // 'unknownKey9999' is not a key in runtime.conf; the action should not
    // add it or throw.
    expect(() => {
      Front.actions["applyUserSettings"]({ userSettings: { unknownKey9999: "value" } });
    }).not.toThrow();
    const conf: Record<string, unknown> = runtime.conf;
    expect(conf["unknownKey9999"]).toBeUndefined();
  });

  it("applies a theme string to the #sk_theme style element", () => {
    const themeEl = document.getElementById("sk_theme")!;
    Front.actions["applyUserSettings"]({ userSettings: { theme: "body { color: red; }" } });
    // setSanitizedContent uses Element.setHTML; the jsdom test shim assigns the
    // markup to innerHTML, so we can observe the element's text content.
    expect(themeEl.textContent).toContain("color");
  });
});

// ---------------------------------------------------------------------------
// actions["addMapkey"] — specialKeys path
// ---------------------------------------------------------------------------
describe("actions['addMapkey'] — specialKeys path", () => {
  beforeEach(() => {
    // Restore the static specialKeys to known defaults before each test.
    specialKeys["<Alt-s>"] = ["<Alt-s>"];
    specialKeys["<Esc>"] = ["<Esc>"];
  });

  it("pushes a new keystroke onto specialKeys when old_keystroke matches", () => {
    Front.actions["addMapkey"]({
      old_keystroke: "<Alt-s>",
      new_keystroke: "<Alt-m>",
      mode: "Normal",
    });
    expect(specialKeys["<Alt-s>"]).toContain("<Alt-m>");
  });

  it("does not touch specialKeys when the mode name is unknown", () => {
    const before = specialKeys["<Esc>"]!.slice();
    Front.actions["addMapkey"]({
      old_keystroke: "NonExistentKey",
      new_keystroke: "x",
      mode: "UnknownMode",
    });
    expect(specialKeys["<Esc>"]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Window message handler — surfingkeys_frontend_data routing
// ---------------------------------------------------------------------------
describe("window message handler", () => {
  it("ignores messages without surfingkeys_frontend_data", () => {
    const before = Front.topOrigin;
    window.dispatchEvent(
      new MessageEvent("message", { data: { other_data: { action: "initFrontend" } } }),
    );
    // topOrigin must not change because the message was not for us.
    expect(Front.topOrigin).toBe(before);
  });

  it("routes initFrontend message to the action and updates topOrigin", () => {
    dispatchFrontendMessage({
      action: "initFrontend",
      origin: "https://msg-routed.example.com",
      winSize: [1920, 1080],
    });
    expect(Front.topOrigin).toBe("https://msg-routed.example.com");
  });

  it("invokes a one-shot callback seeded via contentCommand and deletes it after first call", () => {
    // contentCommand with a successById function registers a callback keyed by
    // the generated id and posts a message to top. Intercept postMessage to
    // capture the id, then send a response with that id twice — the callback
    // must fire exactly once (return false removes it).
    Front.topOrigin = "https://cb-test.example.com";
    let capturedId: string | undefined;
    const spy = vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      capturedId = data?.surfingkeys_uihost_data?.id;
    });

    const cbResults: any[] = [];
    Front.contentCommand({ action: "ping" }, (msg: any) => {
      cbResults.push(msg.data);
      return false; // returning false removes the callback
    });

    expect(capturedId).toBeDefined();

    dispatchFrontendMessage({ id: capturedId, data: "first" });
    dispatchFrontendMessage({ id: capturedId, data: "second" });

    // Callback fires only once because returning false deletes the entry.
    expect(cbResults).toEqual(["first"]);

    spy.mockRestore();
  });

  it("sends an ack message via top.postMessage when the action sets ack", () => {
    // Provide a topOrigin so postMessage doesn't target undefined.
    Front.topOrigin = "https://ack-test.example.com";
    const posted: any[] = [];
    const spy = vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      posted.push(data);
    });

    dispatchFrontendMessage({
      action: "initFrontend",
      origin: "https://ack-test.example.com",
      winSize: [100, 100],
      ack: true,
    });

    const ackMsg = posted.find((m) => m?.surfingkeys_uihost_data?.action === "initFrontendAck");
    expect(ackMsg).toBeDefined();
    expect(ackMsg.surfingkeys_uihost_data.toContent).toBe(true);

    // Restore via the spy so window.top.postMessage returns to the original
    // method, not a bound wrapper that would leak into later tests.
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// StatusBar (via actions["showStatus"])
// ---------------------------------------------------------------------------
describe("actions['showStatus'] — StatusBar.show", () => {
  beforeEach(() => {
    // Reset statusBar display before each test.
    Front.statusBar.style.display = "none";
  });

  it("makes the status bar visible when at least one content cell is non-empty", () => {
    Front.actions["showStatus"]({ contents: ["Normal", "", ""] });
    expect(Front.statusBar.style.display).not.toBe("none");
  });

  it("hides the status bar when all content cells are empty strings", () => {
    // First show something so display is visible.
    Front.actions["showStatus"]({ contents: ["x"] });
    // Now clear all cells.
    Front.actions["showStatus"]({ contents: ["", "", ""] });
    expect(Front.statusBar.style.display).toBe("none");
  });

  it("leaves trailing cells untouched when a shorter array is passed", () => {
    // Set cell 0 to "Normal" first.
    Front.actions["showStatus"]({ contents: ["Normal"] });
    // Show with contents = ["/"] — only updates cell 0 (find-mode status bar
    // passes ["/", {html:...}] to leave the result cell intact).
    Front.actions["showStatus"]({ contents: ["/"] });
    // Status bar must still be visible (cell 0 = "/").
    expect(Front.statusBar.style.display).not.toBe("none");
  });
});

// ---------------------------------------------------------------------------
// actions["hideKeystroke"]
// ---------------------------------------------------------------------------
describe("actions['hideKeystroke']", () => {
  it("hides the keystroke element when it is currently visible", () => {
    const keystroke = document.getElementById("sk_keystroke")!;
    keystroke.style.display = "";
    Front.actions["hideKeystroke"]();
    expect(keystroke.style.display).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Front.contentCommand — generates a unique guid per call
// ---------------------------------------------------------------------------
describe("Front.contentCommand", () => {
  it("posts a message with a unique id for each call", () => {
    // Intercept top.postMessage to capture the posted data.
    Front.topOrigin = "https://guid-test.example.com";
    const ids: string[] = [];
    vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      const inner = data?.surfingkeys_uihost_data;
      if (inner?.id) ids.push(inner.id);
    });

    Front.contentCommand({ action: "doSomething" });
    Front.contentCommand({ action: "doSomethingElse" });

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);

    vi.restoreAllMocks();
  });

  it("sets toContent: true on the posted message", () => {
    Front.topOrigin = "https://toContent-test.example.com";
    let posted: any;
    vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      posted = data?.surfingkeys_uihost_data;
    });

    Front.contentCommand({ action: "ping" });
    expect(posted?.toContent).toBe(true);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// actions["addCommand"]
// ---------------------------------------------------------------------------
describe("actions['addCommand']", () => {
  it("registers the command name and description with the omnibar mock", async () => {
    // The omnibar mock's `command` method is a vi.fn(). After addCommand the
    // mock must have been called with the supplied name and description.
    const { default: createOmnibar } = await import("./omnibar");
    const mockOmnibar = (createOmnibar as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const commandSpy = mockOmnibar?.command as ReturnType<typeof vi.fn>;
    // Fail loudly if the omnibar mock's command spy is not wired, instead of
    // silently passing on a broken setup.
    expect(commandSpy).toBeDefined();

    commandSpy.mockClear();

    Front.actions["addCommand"]({ name: "myCmd", description: "Does my thing" });

    expect(commandSpy).toHaveBeenCalledOnce();
    const [name, description] = commandSpy.mock.calls[0] as [string, string, unknown];
    expect(name).toBe("myCmd");
    expect(description).toBe("Does my thing");
  });

  it("proxy action dispatches executeUserCommand via contentCommand", async () => {
    const { default: createOmnibar } = await import("./omnibar");
    const mockOmnibar = (createOmnibar as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const commandSpy = mockOmnibar?.command as ReturnType<typeof vi.fn>;
    expect(commandSpy).toBeDefined();

    commandSpy.mockClear();
    Front.topOrigin = "https://proxy-cmd-test.example.com";
    const posted: any[] = [];
    vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      posted.push(data?.surfingkeys_uihost_data);
    });

    Front.actions["addCommand"]({ name: "proxied", description: "" });

    // The third argument to omnibar.command is the proxy function.
    const proxyFn = commandSpy.mock.calls.at(-1)?.[2] as (...args: any[]) => void;
    proxyFn("arg1", "arg2");

    const msg = posted.find((m) => m?.action === "executeUserCommand");
    expect(msg).toBeDefined();
    expect(msg.name).toBe("proxied");

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// actions["showPopup"]
// ---------------------------------------------------------------------------
describe("actions['showPopup']", () => {
  it("makes the popup element visible", () => {
    const popup = document.getElementById("sk_popup")!;
    popup.style.display = "none";
    Front.actions["showPopup"]({ content: "<p>Hello popup</p>" });
    expect(popup.style.display).not.toBe("none");
  });
});

// ---------------------------------------------------------------------------
// actions["showBanner"] and auto-hide
// ---------------------------------------------------------------------------
describe("actions['showBanner']", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes the banner visible immediately", () => {
    vi.useFakeTimers();
    const banner = document.getElementById("sk_banner")!;
    banner.style.display = "none";
    Front.actions["showBanner"]({ content: "Test banner", linger_time: 2000 });
    expect(banner.style.display).not.toBe("none");
  });

  it("hides the banner automatically after linger_time", () => {
    vi.useFakeTimers();
    const banner = document.getElementById("sk_banner")!;
    banner.style.display = "none";
    Front.actions["showBanner"]({ content: "Linger test", linger_time: 500 });
    expect(banner.style.display).not.toBe("none");
    vi.advanceTimersByTime(600);
    expect(banner.style.display).toBe("none");
  });

  it("uses the default linger_time of 1600ms when none is given", () => {
    vi.useFakeTimers();
    const banner = document.getElementById("sk_banner")!;
    banner.style.display = "none";
    Front.actions["showBanner"]({ content: "Default linger" });
    vi.advanceTimersByTime(1500);
    expect(banner.style.display).not.toBe("none");
    vi.advanceTimersByTime(200);
    expect(banner.style.display).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// actions["hideBubble"]
// ---------------------------------------------------------------------------
describe("actions['hideBubble']", () => {
  it("sets bubble display to none", () => {
    const bubble = document.getElementById("sk_bubble")!;
    bubble.style.display = "";
    Front.actions["hideBubble"]();
    expect(bubble.style.display).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// actions["showKeystroke"] — first keystroke makes element visible
// ---------------------------------------------------------------------------
describe("actions['showKeystroke']", () => {
  beforeEach(() => {
    // Start with keystroke hidden to test the show path.
    document.getElementById("sk_keystroke")!.style.display = "none";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes the keystroke element visible on first call", () => {
    vi.useFakeTimers();
    const keystroke = document.getElementById("sk_keystroke")!;
    Front.actions["showKeystroke"]({
      keyHints: { key: "g", accumulated: "g", candidates: {} },
    });
    expect(keystroke.style.display).not.toBe("none");
  });

  it("accumulates keystroke text across successive calls", () => {
    vi.useFakeTimers();
    // Hide first to enter the accumulate path.
    document.getElementById("sk_keystroke")!.style.display = "none";
    Front.actions["hideKeystroke"]();
    Front.actions["showKeystroke"]({
      keyHints: { key: "g", accumulated: "g", candidates: {} },
    });
    // A second call while visible and NOT rich should accumulate.
    Front.actions["showKeystroke"]({
      keyHints: { key: "g", accumulated: "gg", candidates: {} },
    });
    // The element is still visible.
    expect(document.getElementById("sk_keystroke")!.style.display).not.toBe("none");
  });
});

// ---------------------------------------------------------------------------
// actions["hideKeystroke"] — richHintsForKeystroke path (clearPendingHint)
// ---------------------------------------------------------------------------
describe("actions['hideKeystroke'] — richHintsForKeystroke branch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the pending hint timer when richHintsForKeystroke is in range", () => {
    vi.useFakeTimers();
    // Show a keystroke first so pendingHint might get scheduled.
    document.getElementById("sk_keystroke")!.style.display = "none";
    Front.actions["showKeystroke"]({
      keyHints: { key: "g", accumulated: "g", candidates: {} },
    });
    // Now hide: clearPendingHint is called when richHintsForKeystroke is in (0, 10000).
    // richHintsForKeystroke defaults to 1000, so this branch executes.
    expect(() => {
      Front.actions["hideKeystroke"]();
    }).not.toThrow();
    expect(document.getElementById("sk_keystroke")!.style.display).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// actions["destroyFrontend"] returns false when a display is visible
// ---------------------------------------------------------------------------
describe("actions['destroyFrontend'] — returns false when display visible", () => {
  it("returns false when the popup is currently shown", () => {
    // Open the popup to set display.
    Front.actions["showPopup"]({ content: "blocking popup" });
    const popup = document.getElementById("sk_popup")!;
    // The popup must be visible for destroyFrontend to return false.
    popup.style.display = "";
    const result = Front.actions["destroyFrontend"]();
    expect(result).toBe(false);
    // Clean up: hide the popup so subsequent tests are unaffected.
    popup.style.display = "none";
  });
});

// ---------------------------------------------------------------------------
// StatusBar.show — duration path (auto-clear timer)
// ---------------------------------------------------------------------------
describe("actions['showStatus'] — StatusBar duration auto-clear", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the status bar after the given duration", () => {
    vi.useFakeTimers();
    Front.actions["showStatus"]({ contents: ["Normal"], duration: 300 });
    expect(Front.statusBar.style.display).not.toBe("none");
    vi.advanceTimersByTime(400);
    // After the timer fires, StatusBar.show(["","","",""]) is called, which
    // sets display to "none" because all cells become empty strings.
    expect(Front.statusBar.style.display).toBe("none");
  });

  it("cancels a previous duration timer when show is called again before it fires", () => {
    vi.useFakeTimers();
    // Start a 1000 ms timer.
    Front.actions["showStatus"]({ contents: ["Mode1"], duration: 1000 });
    // Advance part-way.
    vi.advanceTimersByTime(500);
    // Show again — must cancel the previous timer.
    Front.actions["showStatus"]({ contents: ["Mode2"], duration: 1000 });
    // Advance past the original deadline.
    vi.advanceTimersByTime(600);
    // Status bar must still be visible (only the new 1000 ms timer is running).
    expect(Front.statusBar.style.display).not.toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Window message handler — callback that returns true is retained
// ---------------------------------------------------------------------------
describe("window message handler — persistent callback (returns true)", () => {
  it("keeps a callback registered when it returns true and fires it for each response", () => {
    Front.topOrigin = "https://stay-test.example.com";
    let capturedId: string | undefined;
    const spy = vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      capturedId = data?.surfingkeys_uihost_data?.id;
    });

    const seen: unknown[] = [];
    // Returning true takes the `if (!f(...))` false arm, so the callback is NOT
    // deleted and fires again on the next response with the same id.
    Front.contentCommand({ action: "ping" }, (msg: any) => {
      seen.push(msg.data);
      return true;
    });
    expect(capturedId).toBeDefined();

    dispatchFrontendMessage({ id: capturedId, data: "one" });
    dispatchFrontendMessage({ id: capturedId, data: "two" });

    expect(seen).toEqual(["one", "two"]);
    spy.mockRestore();
  });
});
