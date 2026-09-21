/**
 * The module under test is an IIFE that queries the DOM at import time, so the scaffold and vi.mock
 * calls must be established before the module is loaded: vi.mock is hoisted by Vitest, the DOM body
 * is set at top level (which runs after the mocks), and the import itself is deferred to
 * beforeAll.
 *
 * Two paths are absent because jsdom reports zeroes for the layout geometry they read: the position
 * math in actions["showBubble"] (offsetWidth/offsetHeight) and RenderTabs
 * (getBoundingClientRect().height). ShowRichHints is absent for a different reason: its pendingHint
 * timer, in the richHintsForKeystroke range only, is hard to drive reliably.
 */

import { featureGroups } from "@sk/core/featureGroup";
import KeyboardUtils from "@sk/core/keyboardUtils";
import { specialKeys } from "@sk/core/specialKeys";
import { request, runtime } from "@sk/messaging/runtime";
import { flush } from "@sk/test-support/helpers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// createSignal becomes a plain [getter, setter] pair so the IIFE can call the setters without
// Solid's reactive runtime; importOriginal preserves the other exports its refresh plugin needs.
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

// render becomes a no-op so the IIFE's render() calls succeed against empty container stubs;
// importOriginal preserves the exports Solid's compiled component output references.
vi.mock("solid-js/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("solid-js/web")>();
  return { ...actual, render: vi.fn() };
});

const { omnibarCommandSpy, omnibarMappingsRemove } = vi.hoisted(() => ({
  omnibarCommandSpy: vi.fn(),
  omnibarMappingsRemove: vi.fn(),
}));

// The real createOmnibar wires up Solid rendering and its own DOM queries.
vi.mock("./omnibar", () => ({
  default: vi.fn(() => ({
    command: omnibarCommandSpy,
    mappings: { getWords: () => [], remove: omnibarMappingsRemove },
    onShow: vi.fn(),
  })),
}));

// The real ./command registers keybindings on normal-mode.
vi.mock("./command", () => ({ default: vi.fn() }));

vi.mock("@sk/core/api", () => ({ default: vi.fn(() => ({})) }));
vi.mock("@sk/core/default", () => ({
  default: vi.fn(() => ({ nmap: {}, vmap: {}, imap: {} })),
}));
vi.mock("@sk/core/applyDefaultMappings", () => ({
  applyDefaultMappings: vi.fn(),
  registerDefaultExtras: vi.fn(),
}));

// Intercept notify and request so no chrome.runtime.sendMessage reaches the chrome stub.
vi.mock("@sk/messaging/runtime", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@sk/messaging/runtime")>();
  return {
    ...orig,
    notify: vi.fn(),
    request: vi.fn(() => new Promise(() => {})),
  };
});

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

let Front: any;

beforeAll(async () => {
  const mod = await import("./frontend");
  Front = mod.default;
});

beforeEach(() => {
  for (const el of document.body.children) {
    if (el instanceof HTMLElement && el.id.startsWith("sk_")) {
      el.style.display = "none";
    }
  }
  Front.actions["initFrontend"]({ origin: window.location.origin, winSize: [1280, 800] });
});

function dispatchFrontendMessage(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { surfingkeysFrontendData: data },
    }),
  );
}

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

describe("actions['destroyFrontend']", () => {
  it("returns true when no popup display is visible", () => {
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

describe("actions['applyUserSettings']", () => {
  it("merges a known runtime.conf key from userSettings", () => {
    const original = runtime.conf.tabsThreshold;
    Front.actions["applyUserSettings"]({ userSettings: { tabsThreshold: 42 } });
    expect(runtime.conf.tabsThreshold).toBe(42);
    runtime.conf.tabsThreshold = original;
  });

  it("ignores unknown keys that are not in runtime.conf", () => {
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

describe("actions['addMapkey'] — specialKeys path", () => {
  beforeEach(() => {
    specialKeys["<Alt-s>"] = ["<Alt-s>"];
    specialKeys["<Esc>"] = ["<Esc>"];
  });

  it("pushes a new keystroke onto specialKeys when oldKeystroke matches", () => {
    Front.actions["addMapkey"]({
      oldKeystroke: "<Alt-s>",
      newKeystroke: "<Alt-m>",
      mode: "Normal",
    });
    expect(specialKeys["<Alt-s>"]).toContain("<Alt-m>");
  });

  it("does not touch specialKeys when the mode name is unknown", () => {
    const before = specialKeys["<Esc>"]!.slice();
    Front.actions["addMapkey"]({
      oldKeystroke: "NonExistentKey",
      newKeystroke: "x",
      mode: "UnknownMode",
    });
    expect(specialKeys["<Esc>"]).toEqual(before);
  });
});

describe("actions['removeMapkey']", () => {
  beforeEach(() => {
    omnibarMappingsRemove.mockClear();
  });

  it("removes the encoded keystroke from the named mode's mappings", () => {
    Front.actions["removeMapkey"]({
      mode: "Omnibar",
      keystroke: "<Ctrl-j>",
    });
    expect(omnibarMappingsRemove).toHaveBeenCalledWith(KeyboardUtils.encodeKeystroke("<Ctrl-j>"));
  });

  it("removes nothing when the mode name is unknown", () => {
    Front.actions["removeMapkey"]({
      mode: "UnknownMode",
      keystroke: "<Ctrl-j>",
    });
    expect(omnibarMappingsRemove).not.toHaveBeenCalled();
  });
});

describe("window message handler", () => {
  it("ignores messages without surfingkeysFrontendData", () => {
    const before = Front.topOrigin;
    window.dispatchEvent(
      new MessageEvent("message", { data: { otherData: { action: "initFrontend" } } }),
    );
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
    // The callback id is generated inside contentCommand and reachable only through the
    // message it posts to top, so the spy exists to capture it, not to assert on it.
    Front.topOrigin = "https://cb-test.example.com";
    let capturedId: string | undefined;
    const spy = vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      capturedId = data?.surfingkeysUiHostData?.id;
    });

    const cbResults: any[] = [];
    Front.contentCommand({ action: "ping" }, (msg: any) => {
      cbResults.push(msg.data);
      return false;
    });

    expect(capturedId).toBeDefined();

    dispatchFrontendMessage({ id: capturedId, data: "first" });
    dispatchFrontendMessage({ id: capturedId, data: "second" });

    expect(cbResults).toEqual(["first"]);

    spy.mockRestore();
  });

  it("sends an ack message via top.postMessage when the action sets ack", () => {
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

    const ackMsg = posted.find((m) => m?.surfingkeysUiHostData?.action === "initFrontendAck");
    expect(ackMsg).toBeDefined();
    expect(ackMsg.surfingkeysUiHostData.toContent).toBe(true);

    // Restore via the spy so window.top.postMessage returns to the original
    // method, not a bound wrapper that would leak into later tests.
    spy.mockRestore();
  });
});

describe("actions['showStatus'] — StatusBar.show", () => {
  beforeEach(() => {
    Front.statusBar.style.display = "none";
  });

  it("makes the status bar visible when at least one content cell is non-empty", () => {
    Front.actions["showStatus"]({ contents: ["Normal", "", ""] });
    expect(Front.statusBar.style.display).not.toBe("none");
  });

  it("hides the status bar when all content cells are empty strings", () => {
    Front.actions["showStatus"]({ contents: ["x"] });
    Front.actions["showStatus"]({ contents: ["", "", ""] });
    expect(Front.statusBar.style.display).toBe("none");
  });

  it("leaves trailing cells untouched when a shorter array is passed", () => {
    Front.actions["showStatus"]({ contents: ["Normal"] });
    // Find mode relies on this: it passes ["/", {html:...}] to leave the result cell intact.
    Front.actions["showStatus"]({ contents: ["/"] });
    expect(Front.statusBar.style.display).not.toBe("none");
  });
});

describe("actions['hideKeystroke']", () => {
  it("hides the keystroke element when it is currently visible", () => {
    const keystroke = document.getElementById("sk_keystroke")!;
    keystroke.style.display = "";
    Front.actions["hideKeystroke"]();
    expect(keystroke.style.display).toBe("none");
  });
});

describe("Front.contentCommand", () => {
  it("posts a message with a unique id for each call", () => {
    Front.topOrigin = "https://guid-test.example.com";
    const ids: string[] = [];
    vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      const inner = data?.surfingkeysUiHostData;
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
      posted = data?.surfingkeysUiHostData;
    });

    Front.contentCommand({ action: "ping" });
    expect(posted?.toContent).toBe(true);

    vi.restoreAllMocks();
  });
});

describe("actions['addCommand']", () => {
  beforeEach(() => {
    omnibarCommandSpy.mockClear();
  });

  it("registers the command name and description with the omnibar mock", () => {
    Front.actions["addCommand"]({ name: "myCmd", description: "Does my thing" });

    expect(omnibarCommandSpy).toHaveBeenCalledOnce();
    const [name, , options] = omnibarCommandSpy.mock.calls[0] as [
      string,
      unknown,
      { annotation: string },
    ];
    expect(name).toBe("myCmd");
    expect(options.annotation).toBe("Does my thing");
  });

  it("proxy action dispatches executeUserCommand via contentCommand", () => {
    Front.topOrigin = "https://proxy-cmd-test.example.com";
    const posted: any[] = [];
    vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      posted.push(data?.surfingkeysUiHostData);
    });

    Front.actions["addCommand"]({ name: "proxied", description: "" });

    const proxyFn = omnibarCommandSpy.mock.calls.at(-1)?.[1] as (...args: any[]) => void;
    proxyFn("arg1", "arg2");

    const msg = posted.find((m) => m?.action === "executeUserCommand");
    expect(msg).toBeDefined();
    expect(msg.name).toBe("proxied");

    vi.restoreAllMocks();
  });
});

describe("actions['showPopup']", () => {
  it("makes the popup element visible", () => {
    const popup = document.getElementById("sk_popup")!;
    popup.style.display = "none";
    Front.actions["showPopup"]({ content: "<p>Hello popup</p>" });
    expect(popup.style.display).not.toBe("none");
  });
});

describe("actions['showBanner']", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes the banner visible immediately", () => {
    vi.useFakeTimers();
    const banner = document.getElementById("sk_banner")!;
    banner.style.display = "none";
    Front.actions["showBanner"]({ content: "Test banner", lingerTime: 2000 });
    expect(banner.style.display).not.toBe("none");
  });

  it("hides the banner automatically after lingerTime", () => {
    vi.useFakeTimers();
    const banner = document.getElementById("sk_banner")!;
    banner.style.display = "none";
    Front.actions["showBanner"]({ content: "Linger test", lingerTime: 500 });
    expect(banner.style.display).not.toBe("none");
    vi.advanceTimersByTime(600);
    expect(banner.style.display).toBe("none");
  });

  it("uses the default lingerTime of 1600ms when none is given", () => {
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

describe("actions['hideBubble']", () => {
  it("sets bubble display to none", () => {
    const bubble = document.getElementById("sk_bubble")!;
    bubble.style.display = "";
    Front.actions["hideBubble"]();
    expect(bubble.style.display).toBe("none");
  });
});

describe("actions['showKeystroke']", () => {
  beforeEach(() => {
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
    document.getElementById("sk_keystroke")!.style.display = "none";
    Front.actions["hideKeystroke"]();
    Front.actions["showKeystroke"]({
      keyHints: { key: "g", accumulated: "g", candidates: {} },
    });
    Front.actions["showKeystroke"]({
      keyHints: { key: "g", accumulated: "gg", candidates: {} },
    });
    expect(document.getElementById("sk_keystroke")!.style.display).not.toBe("none");
  });
});

describe("actions['hideKeystroke'] — richHintsForKeystroke branch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the pending hint timer when richHintsForKeystroke is in range", () => {
    vi.useFakeTimers();
    document.getElementById("sk_keystroke")!.style.display = "none";
    Front.actions["showKeystroke"]({
      keyHints: { key: "g", accumulated: "g", candidates: {} },
    });
    // clearPendingHint runs only when richHintsForKeystroke is in (0, 10000); the branch is
    // reached here because the setting is left at its default of 1000.
    expect(() => {
      Front.actions["hideKeystroke"]();
    }).not.toThrow();
    expect(document.getElementById("sk_keystroke")!.style.display).toBe("none");
  });
});

describe("actions['destroyFrontend'] — returns false when display visible", () => {
  it("returns false when the popup is currently shown", () => {
    Front.actions["showPopup"]({ content: "blocking popup" });
    const popup = document.getElementById("sk_popup")!;
    popup.style.display = "";
    const result = Front.actions["destroyFrontend"]();
    expect(result).toBe(false);
    popup.style.display = "none";
  });
});

describe("actions['showStatus'] — StatusBar duration auto-clear", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the status bar after the given duration", () => {
    vi.useFakeTimers();
    Front.actions["showStatus"]({ contents: ["Normal"], duration: 300 });
    expect(Front.statusBar.style.display).not.toBe("none");
    vi.advanceTimersByTime(400);
    expect(Front.statusBar.style.display).toBe("none");
  });

  it("cancels a previous duration timer when show is called again before it fires", () => {
    vi.useFakeTimers();
    Front.actions["showStatus"]({ contents: ["Mode1"], duration: 1000 });
    vi.advanceTimersByTime(500);
    Front.actions["showStatus"]({ contents: ["Mode2"], duration: 1000 });
    vi.advanceTimersByTime(600);
    expect(Front.statusBar.style.display).not.toBe("none");
  });
});

describe("window message handler — persistent callback (returns true)", () => {
  it("keeps a callback registered when it returns true and fires it for each response", () => {
    Front.topOrigin = "https://stay-test.example.com";
    let capturedId: string | undefined;
    const spy = vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      capturedId = data?.surfingkeysUiHostData?.id;
    });

    const seen: unknown[] = [];
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

describe("Find — ArrowUp/ArrowDown history recall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Front.statusBar.querySelector("#sk_find")?.remove();
  });

  it("sends the recalled history entry as the visualUpdate query", async () => {
    // The solid-js/web mock stubs `render`, so StatusBar.show() mounts nothing; the input that
    // Find.open() queries has to be seeded by hand.
    const findInput = document.createElement("input");
    findInput.id = "sk_find";
    Front.statusBar.appendChild(findInput);

    vi.mocked(request).mockResolvedValueOnce({ settings: { findHistory: ["recalled query"] } });

    Front.actions["openFinder"]();
    await flush();

    Front.topOrigin = "https://find-history-test.example.com";
    const posted: any[] = [];
    vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      posted.push(data);
    });

    const upArrowEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      keyCode: 38,
    } as KeyboardEventInit);
    findInput.dispatchEvent(upArrowEvent);

    const updateMsg = posted.find((m) => m?.surfingkeysUiHostData?.action === "visualUpdate");
    expect(updateMsg).toBeDefined();
    expect(updateMsg.surfingkeysUiHostData.query).toBe("recalled query");
    expect(findInput.value).toBe("recalled query");
  });
});

describe("actions['getUsage'] feature group placement", () => {
  function renderUsage(metas: Record<string, unknown>[]): string {
    Front.topOrigin = "https://usage-test.example.com";
    let html = "";
    vi.spyOn(window.top!, "postMessage").mockImplementation((data: any) => {
      html = data?.surfingkeysUiHostData?.data ?? "";
    });
    Front.actions["getUsage"]({ metas, id: 1 });
    return html;
  }

  function sectionsOf(html: string): { title: string; annotations: string[] }[] {
    const host = document.createElement("div");
    host.innerHTML = html;
    return [...host.querySelectorAll(".feature_name")].map((heading) => {
      const section = heading.parentElement!;
      return {
        title: heading.textContent ?? "",
        annotations: [...section.querySelectorAll(".annotation")].map((a) => a.textContent ?? ""),
      };
    });
  }

  it("renders each feature group under its own section title, in declared order", () => {
    const metas = featureGroups.map(({ key }) => ({
      word: `k_${key}`,
      group: key,
      annotation: `ANN_${key}`,
    }));

    const titled = sectionsOf(renderUsage(metas)).map((s) => [
      s.title,
      s.annotations.filter((a) => a.startsWith("ANN_")),
    ]);

    expect(titled).toEqual([
      ["Help", ["ANN_help"]],
      ["Mouse Click", ["ANN_mouseClick"]],
      ["Scroll Page / Element", ["ANN_scroll"]],
      ["Tabs", ["ANN_tabs"]],
      ["Page Navigation", ["ANN_pageNavigation"]],
      ["Sessions", ["ANN_sessions"]],
      ["Search selected with", ["ANN_searchSelectedWith"]],
      ["Clipboard", ["ANN_clipboard"]],
      ["Omnibar", ["ANN_omnibar"]],
      ["Visual Mode", ["ANN_visualMode"]],
      ["vim-like marks", ["ANN_marks"]],
      ["Settings", ["ANN_settings"]],
      ["Chrome URLs", ["ANN_chromeUrls"]],
      ["Misc", ["ANN_misc"]],
      ["Insert Mode", ["ANN_insertMode"]],
      ["Lurk Mode", ["ANN_lurkMode"]],
      ["Regional Hints Mode", ["ANN_regionalHintsMode"]],
    ]);
  });

  it("omits a section whose feature group has no mappings", () => {
    const sections = sectionsOf(
      renderUsage([{ word: "k", group: "tabs", annotation: "ANN_tabs" }]),
    ).filter((s) => s.annotations.some((a) => a.startsWith("ANN_")));

    expect(sections.map((s) => s.title)).toEqual(["Tabs"]);
  });

  it("drops a mapping whose feature group names no section", () => {
    const html = renderUsage([
      { word: "k", group: "tabs", annotation: "ANN_tabs" },
      { word: "u", group: "nosuchgroup", annotation: "ANN_unknown" },
    ]);

    expect(html).not.toContain("ANN_unknown");
    expect(html).toContain("ANN_tabs");
  });
});
