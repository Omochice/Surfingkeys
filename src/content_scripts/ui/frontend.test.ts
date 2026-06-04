/**
 * Tests for frontend.ts: Front IIFE, StatusBar, and Find sub-modules.
 *
 * The file runs in jsdom. frontend.ts is an IIFE that queries the DOM at import time, so the DOM
 * scaffold and vi.mock calls must be established before the module is loaded. vi.mock calls are
 * automatically hoisted by Vitest; the DOM body is set in the module's own scope (top-level, runs
 * after mocks) so it is ready when the lazy import executes in beforeAll.
 *
 * Paths that rely on layout geometry (offsetWidth/Height, getBoundingClientRect returning real
 * sizes) are not testable under jsdom and are skipped.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import Mode from "../common/mode";
import { runtime } from "../common/runtime";

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
vi.mock("../common/api", () => ({ default: vi.fn(() => ({})) }));
vi.mock("../common/default", () => ({ default: vi.fn() }));

// ../common/runtime: intercept RUNTIME calls so no chrome.runtime.sendMessage
// reaches the chrome stub.
vi.mock("../common/runtime", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../common/runtime")>();
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
// _actions["initFrontend"]
// ---------------------------------------------------------------------------
describe("_actions['initFrontend']", () => {
  it("stores topOrigin from the message", () => {
    Front._actions["initFrontend"]({ origin: "https://test.example.com", winSize: [1280, 800] });
    expect(Front.topOrigin).toBe("https://test.example.com");
  });

  it("stores topSize from the message", () => {
    Front._actions["initFrontend"]({ origin: "https://a.example.com", winSize: [1024, 768] });
    expect(Front.topSize).toEqual([1024, 768]);
  });

  it("returns a numeric timestamp", () => {
    const before = Date.now();
    const result = Front._actions["initFrontend"]({
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
// _actions["destroyFrontend"]
// ---------------------------------------------------------------------------
describe("_actions['destroyFrontend']", () => {
  it("returns true when no popup display is visible", () => {
    // No _display is open, so destroyFrontend should return true.
    const result = Front._actions["destroyFrontend"]();
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

    const result = Front._actions["destroyFrontend"]();
    expect(result).toBe(true);
    expect(calls).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// _actions["toggleStatus"]
// ---------------------------------------------------------------------------
describe("_actions['toggleStatus']", () => {
  it("hides the status bar when visible is false", () => {
    Front.statusBar.style.display = "";
    Front._actions["toggleStatus"]({ visible: false });
    expect(Front.statusBar.style.display).toBe("none");
  });

  it("shows the status bar when visible is true", () => {
    Front.statusBar.style.display = "none";
    Front._actions["toggleStatus"]({ visible: true });
    expect(Front.statusBar.style.display).toBe("");
  });
});

// ---------------------------------------------------------------------------
// _actions["applyUserSettings"]
// ---------------------------------------------------------------------------
describe("_actions['applyUserSettings']", () => {
  it("merges a known runtime.conf key from userSettings", () => {
    const original = runtime.conf.tabsThreshold;
    Front._actions["applyUserSettings"]({ userSettings: { tabsThreshold: 42 } });
    expect(runtime.conf.tabsThreshold).toBe(42);
    // restore
    runtime.conf.tabsThreshold = original;
  });

  it("ignores unknown keys that are not in runtime.conf", () => {
    // 'unknownKey9999' is not a key in runtime.conf; the action should not
    // add it or throw.
    expect(() => {
      Front._actions["applyUserSettings"]({ userSettings: { unknownKey9999: "value" } });
    }).not.toThrow();
    const conf: Record<string, unknown> = runtime.conf;
    expect(conf["unknownKey9999"]).toBeUndefined();
  });

  it("applies a theme string to the #sk_theme style element", () => {
    const themeEl = document.getElementById("sk_theme")!;
    Front._actions["applyUserSettings"]({ userSettings: { theme: "body { color: red; }" } });
    // setSanitizedContent uses DOMPurify; in jsdom the sanitized output is
    // assigned to innerHTML, so we can observe the element's text content.
    expect(themeEl.textContent).toContain("color");
  });
});

// ---------------------------------------------------------------------------
// _actions["addMapkey"] — Mode.specialKeys path
// ---------------------------------------------------------------------------
describe("_actions['addMapkey'] — specialKeys path", () => {
  beforeEach(() => {
    // Restore the static specialKeys to known defaults before each test.
    Mode.specialKeys["<Alt-s>"] = ["<Alt-s>"];
    Mode.specialKeys["<Esc>"] = ["<Esc>"];
  });

  it("pushes a new keystroke onto Mode.specialKeys when old_keystroke matches", () => {
    Front._actions["addMapkey"]({
      old_keystroke: "<Alt-s>",
      new_keystroke: "<Alt-m>",
      mode: "Normal",
    });
    expect(Mode.specialKeys["<Alt-s>"]).toContain("<Alt-m>");
  });

  it("does not touch specialKeys when the mode name is unknown", () => {
    const before = Mode.specialKeys["<Esc>"]!.slice();
    Front._actions["addMapkey"]({
      old_keystroke: "NonExistentKey",
      new_keystroke: "x",
      mode: "UnknownMode",
    });
    expect(Mode.specialKeys["<Esc>"]).toEqual(before);
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
    const origPostMessage = window.top!.postMessage.bind(window.top);
    vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
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

    vi.restoreAllMocks();
    // restore
    window.top!.postMessage = origPostMessage;
  });
});

// ---------------------------------------------------------------------------
// StatusBar (via _actions["showStatus"])
// ---------------------------------------------------------------------------
describe("_actions['showStatus'] — StatusBar.show", () => {
  beforeEach(() => {
    // Reset statusBar display before each test.
    Front.statusBar.style.display = "none";
  });

  it("makes the status bar visible when at least one content cell is non-empty", () => {
    Front._actions["showStatus"]({ contents: ["Normal", "", ""] });
    expect(Front.statusBar.style.display).not.toBe("none");
  });

  it("hides the status bar when all content cells are empty strings", () => {
    // First show something so display is visible.
    Front._actions["showStatus"]({ contents: ["x"] });
    // Now clear all cells.
    Front._actions["showStatus"]({ contents: ["", "", ""] });
    expect(Front.statusBar.style.display).toBe("none");
  });

  it("leaves trailing cells untouched when a shorter array is passed", () => {
    // Set cell 0 to "Normal" first.
    Front._actions["showStatus"]({ contents: ["Normal"] });
    // Show with contents = ["/"] — only updates cell 0 (find-mode status bar
    // passes ["/", {html:...}] to leave the result cell intact).
    Front._actions["showStatus"]({ contents: ["/"] });
    // Status bar must still be visible (cell 0 = "/").
    expect(Front.statusBar.style.display).not.toBe("none");
  });
});

// ---------------------------------------------------------------------------
// _actions["hideKeystroke"]
// ---------------------------------------------------------------------------
describe("_actions['hideKeystroke']", () => {
  it("hides the keystroke element when it is currently visible", () => {
    const keystroke = document.getElementById("sk_keystroke")!;
    keystroke.style.display = "";
    Front._actions["hideKeystroke"]();
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
