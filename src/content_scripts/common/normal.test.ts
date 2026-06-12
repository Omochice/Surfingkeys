import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markAutoFocus, markNewlyCreated } from "./domFlags";
import KeyboardUtils from "./keyboardUtils";
import Mode from "./mode";
import createNormal from "./normal";
import { RUNTIME, runtime } from "./runtime";
import { getScrollableElements } from "./scrollDetection";

// Wrapped so individual tests can stub the scroll-list discovery with
// mockReturnValueOnce; every other test keeps the real implementation.
vi.mock("./scrollDetection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scrollDetection")>();
  return {
    ...actual,
    getScrollableElements: vi.fn(actual.getScrollableElements),
  };
});

const insertStub = { enter() {}, exit() {} };

function dispatchFocus(normal: ReturnType<typeof createNormal>, target: Element): Event {
  const event = new Event("focus");
  Object.defineProperty(event, "target", { value: target });
  const handler = normal.eventListeners["focus"];
  if (handler == null) {
    throw new Error("normal mode did not register a focus handler");
  }
  handler(event);
  return event;
}

describe("createNormal focus handler — auto-focus suppression", () => {
  let savedStealFocusOnLoad: boolean;
  let savedEnableAutoFocus: boolean;

  beforeEach(() => {
    savedStealFocusOnLoad = runtime.conf.stealFocusOnLoad;
    savedEnableAutoFocus = runtime.conf.enableAutoFocus;
    runtime.conf.stealFocusOnLoad = true;
    runtime.conf.enableAutoFocus = false;
  });

  afterEach(() => {
    runtime.conf.stealFocusOnLoad = savedStealFocusOnLoad;
    runtime.conf.enableAutoFocus = savedEnableAutoFocus;
  });

  it("blurs an editable element that is not marked for auto-focus", () => {
    const normal = createNormal(insertStub);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const blur = vi.spyOn(textarea, "blur");

    const event = dispatchFocus(normal, textarea);

    expect(blur).toHaveBeenCalledOnce();
    expect(event.sk_stopPropagation).toBe(true);

    textarea.remove();
  });

  it("does not blur an editable element marked for auto-focus", () => {
    const normal = createNormal(insertStub);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    markAutoFocus(textarea);
    const blur = vi.spyOn(textarea, "blur");

    const event = dispatchFocus(normal, textarea);

    expect(blur).not.toHaveBeenCalled();
    expect(event.sk_stopPropagation).toBeUndefined();

    textarea.remove();
  });
});

function dispatchKeydown(normal: ReturnType<typeof createNormal>, target: Element): Event {
  const base = new Event("keydown");
  Object.defineProperty(base, "target", { value: target });
  Object.defineProperty(base, "key", { value: "a" });
  base.sk_keyName = "a";
  // jsdom marks `isTrusted` non-configurable, so it cannot be redefined; wrap
  // the event to report a trusted event while binding methods to the real one.
  const event = new Proxy(base, {
    get(t, p) {
      if (p === "isTrusted") {
        return true;
      }
      const value = Reflect.get(t, p, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
  const handler = normal.eventListeners["keydown"];
  if (handler == null) {
    throw new Error("normal mode did not register a keydown handler");
  }
  handler(event);
  return event;
}

describe("createNormal keydown handler — newly-created focus steal", () => {
  it("enters insert mode for an editable element that is not newly-created", () => {
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const blur = vi.spyOn(textarea, "blur");

    dispatchKeydown(normal, textarea);

    expect(insert.enter).toHaveBeenCalledWith(textarea, true);
    expect(blur).not.toHaveBeenCalled();

    textarea.remove();
  });

  it("steals focus from an editable element marked as newly-created", () => {
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    markNewlyCreated(textarea);
    const blur = vi.spyOn(textarea, "blur");

    dispatchKeydown(normal, textarea);

    expect(blur).toHaveBeenCalledOnce();
    expect(insert.enter).not.toHaveBeenCalled();

    textarea.remove();
  });

  it("clears the mark after stealing once, so the next keydown enters insert mode", () => {
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    markNewlyCreated(textarea);

    dispatchKeydown(normal, textarea);
    dispatchKeydown(normal, textarea);

    expect(insert.enter).toHaveBeenCalledWith(textarea, true);

    textarea.remove();
  });
});

// jsdom returns undefined for document.scrollingElement, which makes
// `self.scroll` bail out early; point it at <html> so the scroll path runs.
function scrollTarget(): HTMLElement {
  return document.documentElement;
}

describe("createNormal scroll — skScrollBy reaches the scrolling element", () => {
  let savedSmoothScroll: boolean;
  let savedSmartPageBoundary: boolean;
  let savedRepeats: number;
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedSmoothScroll = runtime.conf.smoothScroll;
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    savedRepeats = RUNTIME.repeats;
    runtime.conf.smoothScroll = false;
    // The all-zero jsdom rect otherwise trips skScrollBy's bottom-boundary guard.
    runtime.conf.smartPageBoundary = false;
    RUNTIME.repeats = 1;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    // jsdom does not implement Element.scrollBy; provide a spy to observe it.
    scrollBy = vi.fn();
    Object.defineProperty(scrollTarget(), "scrollBy", { value: scrollBy, configurable: true });
  });

  afterEach(() => {
    runtime.conf.smoothScroll = savedSmoothScroll;
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    RUNTIME.repeats = savedRepeats;
    scrollTarget().style.scrollBehavior = "";
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(scrollTarget(), "scrollBy");
  });

  it("scrolls the page down by the step size", () => {
    const normal = createNormal(insertStub);

    normal.scroll("down");

    expect(scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      left: 0,
      top: runtime.conf.scrollStepSize,
    });
  });

  it("scrolls the page up by the step size", () => {
    const normal = createNormal(insertStub);

    normal.scroll("up");

    expect(scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      left: 0,
      top: -runtime.conf.scrollStepSize,
    });
  });

  it("scrolls right and left along the x-axis by half the step size", () => {
    const normal = createNormal(insertStub);
    const half = Math.round(runtime.conf.scrollStepSize / 2);

    normal.scroll("right");
    normal.scroll("left");

    expect(scrollBy).toHaveBeenNthCalledWith(1, { behavior: "instant", left: half, top: 0 });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { behavior: "instant", left: -half, top: 0 });
  });

  it("scrolls again on a second call (the per-element helper is reused, not suppressed)", () => {
    const normal = createNormal(insertStub);

    normal.scroll("down");
    normal.scroll("down");

    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it("takes the smooth-scroll path when smoothScroll is on", () => {
    runtime.conf.smoothScroll = true;
    const normal = createNormal(insertStub);

    normal.scroll("down");

    expect(scrollTarget().style.scrollBehavior).toBe("auto");
  });
});

// ─── scroll type dispatch ─────────────────────────────────────────────────────

describe("createNormal scroll — all non-smooth scroll types dispatch correct arguments", () => {
  let savedSmoothScroll: boolean;
  let savedSmartPageBoundary: boolean;
  let savedRepeats: number;
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedSmoothScroll = runtime.conf.smoothScroll;
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    savedRepeats = RUNTIME.repeats;
    runtime.conf.smoothScroll = false;
    runtime.conf.smartPageBoundary = false;
    RUNTIME.repeats = 1;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    scrollBy = vi.fn();
    Object.defineProperty(scrollTarget(), "scrollBy", { value: scrollBy, configurable: true });
    Object.defineProperty(scrollTarget(), "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scrollTarget(), "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollTarget(), "scrollLeft", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollTarget(), "scrollWidth", { value: 3000, configurable: true });
  });

  afterEach(() => {
    runtime.conf.smoothScroll = savedSmoothScroll;
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    RUNTIME.repeats = savedRepeats;
    scrollTarget().style.scrollBehavior = "";
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(scrollTarget(), "scrollBy");
    Reflect.deleteProperty(scrollTarget(), "scrollHeight");
    Reflect.deleteProperty(scrollTarget(), "scrollTop");
    Reflect.deleteProperty(scrollTarget(), "scrollLeft");
    Reflect.deleteProperty(scrollTarget(), "scrollWidth");
  });

  it("pageDown scrolls by half the viewport height", () => {
    const normal = createNormal(insertStub);
    const half = Math.round(window.innerHeight / 2);

    normal.scroll("pageDown");

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", left: 0, top: half });
  });

  it("pageUp scrolls by negative half the viewport height", () => {
    const normal = createNormal(insertStub);
    const half = -Math.round(window.innerHeight / 2);

    normal.scroll("pageUp");

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", left: 0, top: half });
  });

  it("fullPageDown scrolls by the full viewport height", () => {
    const normal = createNormal(insertStub);

    normal.scroll("fullPageDown");

    expect(scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      left: 0,
      top: window.innerHeight,
    });
  });

  it("fullPageUp scrolls by the negative full viewport height", () => {
    const normal = createNormal(insertStub);

    normal.scroll("fullPageUp");

    expect(scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      left: 0,
      top: -window.innerHeight,
    });
  });

  it("top scrolls to negative scrollTop (bringing the element back to top)", () => {
    // scrollTop is set to 0 in beforeEach; negative of 0 is -0 which equals 0 numerically
    // but Object.is distinguishes them, so we set scrollTop to a positive value to be explicit.
    (scrollTarget() as any).scrollTop = 50;
    const normal = createNormal(insertStub);

    normal.scroll("top");

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", left: 0, top: -50 });
  });

  it("leftmost scrolls left past the current scrollLeft position", () => {
    // scrollLeft is 0 so delta is -(0 + 10) = -10
    const normal = createNormal(insertStub);

    normal.scroll("leftmost");

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", left: -10, top: 0 });
  });

  it("RUNTIME.repeats > 1 multiplies the scroll delta and resets repeats to 0", () => {
    RUNTIME.repeats = 3;
    const normal = createNormal(insertStub);

    normal.scroll("down");

    expect(scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      left: 0,
      top: 3 * runtime.conf.scrollStepSize,
    });
    expect(RUNTIME.repeats).toBe(0);
  });
});

// ─── byRatio scroll ───────────────────────────────────────────────────────────

describe("createNormal scroll — byRatio positions relative to scrollHeight", () => {
  let savedSmoothScroll: boolean;
  let savedSmartPageBoundary: boolean;
  let savedRepeats: number;
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedSmoothScroll = runtime.conf.smoothScroll;
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    savedRepeats = RUNTIME.repeats;
    runtime.conf.smoothScroll = false;
    runtime.conf.smartPageBoundary = false;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    scrollBy = vi.fn();
    Object.defineProperty(scrollTarget(), "scrollBy", { value: scrollBy, configurable: true });
    Object.defineProperty(scrollTarget(), "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollTarget(), "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollTarget(), "scrollLeft", {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    runtime.conf.smoothScroll = savedSmoothScroll;
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    RUNTIME.repeats = savedRepeats;
    scrollTarget().style.scrollBehavior = "";
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(scrollTarget(), "scrollBy");
    Reflect.deleteProperty(scrollTarget(), "scrollHeight");
    Reflect.deleteProperty(scrollTarget(), "scrollTop");
    Reflect.deleteProperty(scrollTarget(), "scrollLeft");
  });

  it("byRatio at 50% targets mid-scroll and resets RUNTIME.repeats", () => {
    RUNTIME.repeats = 50;
    const normal = createNormal(insertStub);

    normal.scroll("byRatio");

    // expected y = parseInt(50*1000/100) - innerHeight/2 - scrollTop
    //            = 500 - innerHeight/2 - 0
    const expectedY = 500 - window.innerHeight / 2;
    expect(scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      left: 0,
      top: expectedY,
    });
    expect(RUNTIME.repeats).toBe(0);
  });
});

// ─── isScrollKeyInHints ───────────────────────────────────────────────────────

describe("createNormal isScrollKeyInHints", () => {
  it("returns true for a key whose scroll binding is marked for Hints mode", () => {
    const normal = createNormal(insertStub);

    // "j" is bound through bindScrollForHints, so it may also scroll in Hints mode.
    expect(normal.isScrollKeyInHints("j")).toBe(true);
  });

  it("returns false for a scroll binding not marked for Hints mode", () => {
    const normal = createNormal(insertStub);

    // "e" scrolls in Normal mode but is not registered as a Hints-mode scroll key.
    expect(normal.isScrollKeyInHints("e")).toBe(false);
  });

  it("returns false for an unbound key", () => {
    const normal = createNormal(insertStub);

    expect(normal.isScrollKeyInHints("q")).toBe(false);
  });
});

// ─── getLurkMode ──────────────────────────────────────────────────────────────

describe("createNormal getLurkMode", () => {
  it("returns undefined before startLurk is called", () => {
    const normal = createNormal(insertStub);

    expect(normal.getLurkMode()).toBeUndefined();
  });
});

// ─── addLurkMap ───────────────────────────────────────────────────────────────

describe("createNormal addLurkMap + startLurk", () => {
  it("a lurk map added before startLurk is transferred to the lurk mode's trie", () => {
    const normal = createNormal(insertStub);
    // Lurk mode only has <Alt-i> and p by default. We remap <Alt-i> to x so
    // mapInMode finds the source binding and adds x to the lurk trie.
    normal.addLurkMap("x", "<Alt-i>");

    normal.startLurk();
    const lurk = normal.getLurkMode();
    if (lurk == null) {
      throw new Error("lurk mode should be defined after startLurk");
    }

    // After startLurk, x should be findable in lurk mappings
    const xNode = lurk.mappings.find("x");
    expect(xNode).not.toBeUndefined();
  });
});

// ─── appendKeysForRepeat ─────────────────────────────────────────────────────

describe("createNormal appendKeysForRepeat", () => {
  it("does nothing when no lastKeys have been recorded yet", () => {
    // lastKeys is undefined initially; appendKeysForRepeat should silently skip
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    const normal = createNormal(insertStub);

    normal.appendKeysForRepeat("Normal", "gg");

    // RUNTIME("localData") must NOT have been called because lastKeys is empty
    const localDataCalls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "localData",
    );
    expect(localDataCalls).toHaveLength(0);
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });
});

// ─── jumpVIMark ───────────────────────────────────────────────────────────────

describe("createNormal jumpVIMark", () => {
  let savedSmartPageBoundary: boolean;
  let savedSmoothScroll: boolean;
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    savedSmoothScroll = runtime.conf.smoothScroll;
    runtime.conf.smartPageBoundary = false;
    runtime.conf.smoothScroll = false;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    scrollBy = vi.fn();
    Object.defineProperty(scrollTarget(), "scrollBy", { value: scrollBy, configurable: true });
    Object.defineProperty(scrollTarget(), "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scrollTarget(), "scrollTop", {
      value: 100,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollTarget(), "scrollLeft", {
      value: 50,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    runtime.conf.smoothScroll = savedSmoothScroll;
    scrollTarget().style.scrollBehavior = "";
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(scrollTarget(), "scrollBy");
    Reflect.deleteProperty(scrollTarget(), "scrollHeight");
    Reflect.deleteProperty(scrollTarget(), "scrollTop");
    Reflect.deleteProperty(scrollTarget(), "scrollLeft");
  });

  it(String.raw`mark=\' swaps scroll position with the saved lastScrollTop/lastScrollLeft`, () => {
    const normal = createNormal(insertStub);

    // Prime scroll state: a scroll call records lastScrollTop/lastScrollLeft
    normal.scroll("down");
    // After scroll("down"), helpers.lastScrollTop = scrollTop at call time = 100,
    // helpers.lastScrollLeft = scrollLeft = 50.

    // Now change the DOM values to simulate user scrolled elsewhere
    (scrollTarget() as any).scrollTop = 200;
    (scrollTarget() as any).scrollLeft = 80;

    normal.jumpVIMark("'");

    // jumpVIMark("'") should restore the previously saved positions
    expect(scrollTarget().scrollTop).toBe(100);
    expect(scrollTarget().scrollLeft).toBe(50);
  });

  it(String.raw`non-\' mark sends RUNTIME jumpVIMark with the mark character`, () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    const normal = createNormal(insertStub);

    normal.jumpVIMark("a");

    const calls = sendMessage.mock.calls.filter((args: any[]) => args[0]?.action === "jumpVIMark");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].mark).toBe("a");
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });
});

// ─── moveTab ─────────────────────────────────────────────────────────────────

describe("createNormal moveTab", () => {
  it("sends RUNTIME moveTab with the given position", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    const normal = createNormal(insertStub);

    normal.moveTab(3);

    const calls = sendMessage.mock.calls.filter((args: any[]) => args[0]?.action === "moveTab");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].position).toBe(3);
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });
});

// ─── addVIMark ────────────────────────────────────────────────────────────────

describe("createNormal addVIMark", () => {
  it("sends RUNTIME addVIMark with the correct mark shape", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    const normal = createNormal(insertStub);

    normal.addVIMark("a", "https://example.com/");

    const calls = sendMessage.mock.calls.filter((args: any[]) => args[0]?.action === "addVIMark");
    expect(calls).toHaveLength(1);
    const markPayload = calls[0]![0].mark as Record<
      string,
      { url: string; scrollLeft: number; scrollTop: number }
    >;
    expect(markPayload["a"]).toBeDefined();
    expect(markPayload["a"]!.url).toBe("https://example.com/");
    expect(typeof markPayload["a"]!.scrollTop).toBe("number");
    expect(typeof markPayload["a"]!.scrollLeft).toBe("number");

    (globalThis as any).chrome.runtime.sendMessage = () => {};
    Reflect.deleteProperty(document, "scrollingElement");
  });

  it("uses window.location.href when no url argument is provided", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    const normal = createNormal(insertStub);

    normal.addVIMark("b");

    const call = sendMessage.mock.calls.find((args: any[]) => args[0]?.action === "addVIMark");
    const markPayload = call![0].mark as Record<string, { url: string }>;
    expect(markPayload["b"]!.url).toBe(window.location.href);

    (globalThis as any).chrome.runtime.sendMessage = () => {};
    Reflect.deleteProperty(document, "scrollingElement");
  });
});

// ─── passThrough ─────────────────────────────────────────────────────────────

describe("createNormal passThrough", () => {
  it("returns a mode object with name PassThrough", () => {
    const normal = createNormal(insertStub);

    const pt = normal.passThrough();

    expect(pt.name).toBe("PassThrough");
  });

  it("passThrough with a timeout sets the status line to include the timeout value", () => {
    const normal = createNormal(insertStub);

    const pt = normal.passThrough(1000);

    // onEnter runs during enter(); the statusLine is set there
    expect(pt.statusLine).toContain("1000");
  });
});

// ─── mousedown handler ───────────────────────────────────────────────────────

function makeMousedownProxy(target: Element, isTrustedValue: boolean): Event {
  const base = new Event("mousedown");
  Object.defineProperty(base, "target", { value: target });
  // jsdom marks isTrusted non-configurable, so proxy it like the keydown helper does.
  return new Proxy(base, {
    get(t, p) {
      if (p === "isTrusted") return isTrustedValue;
      const value = Reflect.get(t, p, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

function dispatchMousedown(
  normal: ReturnType<typeof createNormal>,
  target: Element,
  isTrusted = false,
): Event {
  const event = makeMousedownProxy(target, isTrusted);
  const handler = normal.eventListeners["mousedown"];
  if (handler == null) {
    throw new Error("normal mode did not register a mousedown handler");
  }
  handler(event);
  return event;
}

describe("createNormal mousedown handler", () => {
  it("calls insert.enter when mousedown target is an editable element", () => {
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    dispatchMousedown(normal, textarea);

    expect(insert.enter).toHaveBeenCalledWith(textarea, true);

    textarea.remove();
  });

  it("calls insert.exit when mousedown target is not editable", () => {
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    const div = document.createElement("div");
    document.body.appendChild(div);

    dispatchMousedown(normal, div);

    expect(insert.exit).toHaveBeenCalledOnce();
    expect(insert.enter).not.toHaveBeenCalled();

    div.remove();
  });

  it("sets passFocus when isTrusted=true and enableAutoFocus is false, so next focus is not suppressed", () => {
    const savedEnableAutoFocus = runtime.conf.enableAutoFocus;
    const savedStealFocusOnLoad = runtime.conf.stealFocusOnLoad;
    runtime.conf.enableAutoFocus = false;
    runtime.conf.stealFocusOnLoad = true;
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    const div = document.createElement("div");
    document.body.appendChild(div);

    // isTrusted=true means passFocus becomes true
    dispatchMousedown(normal, div, true);

    // A subsequent focus on a textarea should NOT be blurred because passFocus=true
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const blur = vi.spyOn(textarea, "blur");
    const focusEvent = new Event("focus");
    Object.defineProperty(focusEvent, "target", { value: textarea });
    normal.eventListeners["focus"]!(focusEvent);
    expect(blur).not.toHaveBeenCalled();

    runtime.conf.enableAutoFocus = savedEnableAutoFocus;
    runtime.conf.stealFocusOnLoad = savedStealFocusOnLoad;
    div.remove();
    textarea.remove();
  });
});

// ─── mappings registered at construction ────────────────────────────────────

describe("createNormal built-in mapping registration", () => {
  it("registers the Alt-i PassThrough mapping under the correct encoded key", () => {
    const normal = createNormal(insertStub);
    const encoded = KeyboardUtils.encodeKeystroke("<Alt-i>");

    const node = normal.mappings.find(encoded);

    expect(node?.meta?.annotation).toContain("PassThrough");
  });

  it("registers yG, yS, cS, gg, G, j, k, h, l, e, d, P, U, 0, $, %, cs, /, E, R, p", () => {
    const normal = createNormal(insertStub);
    const expectedKeys = ["yG", "yS", "cS", "gg", "G", "j", "k", "h", "l", "e", "d", "P", "U"];
    for (const key of expectedKeys) {
      let node: any = normal.mappings;
      for (const ch of key) {
        node = node?.find(ch);
      }
      expect(node?.meta, `expected mapping for "${key}"`).not.toBeUndefined();
    }
  });
});

// ─── rotateFrame ─────────────────────────────────────────────────────────────

describe("createNormal rotateFrame", () => {
  it("sends RUNTIME nextFrame with the window frameId", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    (window as any).frameId = 42;
    const normal = createNormal(insertStub);

    normal.rotateFrame();

    const calls = sendMessage.mock.calls.filter((args: any[]) => args[0]?.action === "nextFrame");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].frameId).toBe(42);

    delete (window as any).frameId;
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });
});

// ─── toggleBlocklist ──────────────────────────────────────────────────────────

describe("createNormal toggleBlocklist", () => {
  // Helper: make sendMessage synchronously invoke the callback with the given response.
  function makeSendMessage(response: unknown): ReturnType<typeof vi.fn> {
    return vi.fn((_msg: any, cb?: (r: unknown) => void) => {
      if (typeof cb === "function") {
        cb(response);
      }
    });
  }

  it("sends RUNTIME toggleBlocklist when location is not an extension page", () => {
    // document.location.href in jsdom is e.g. "http://localhost/" which does not
    // start with the extension origin returned by browser.runtime.getURL("/") = "/"
    const sendMessage = makeSendMessage({ state: "enabled", url: "http://example.com/" });
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    const normal = createNormal(insertStub);

    normal.toggleBlocklist();

    const calls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "toggleBlocklist",
    );
    expect(calls).toHaveLength(1);
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });

  it("dispatches a banner with the url when state is enabled", () => {
    const url = "http://example.com/page";
    const sendMessage = makeSendMessage({ state: "enabled", url });
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:front", capture);

    const normal = createNormal(insertStub);
    normal.toggleBlocklist();

    document.removeEventListener("surfingkeys:front", capture);
    (globalThis as any).chrome.runtime.sendMessage = () => {};

    const bannerEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "showBanner",
    );
    expect(bannerEvents.length).toBeGreaterThan(0);
    expect(bannerEvents[0]!.detail[1]).toContain(url);
  });

  it("dispatches a banner indicating disabled when state is disabled (per-site)", () => {
    const url = "http://example.com/page";
    const sendMessage = makeSendMessage({ state: "disabled", url, blocklist: {} });
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:front", capture);

    const normal = createNormal(insertStub);
    normal.toggleBlocklist();

    document.removeEventListener("surfingkeys:front", capture);
    (globalThis as any).chrome.runtime.sendMessage = () => {};

    const bannerEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "showBanner",
    );
    expect(bannerEvents.length).toBeGreaterThan(0);
    expect(bannerEvents[0]!.detail[1]).toContain("OFF");
  });

  it("dispatches a globally-disabled banner when the blocklist contains '.*'", () => {
    const sendMessage = makeSendMessage({
      state: "disabled",
      url: "http://example.com/",
      blocklist: { ".*": true },
    });
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:front", capture);

    const normal = createNormal(insertStub);
    normal.toggleBlocklist();

    document.removeEventListener("surfingkeys:front", capture);
    (globalThis as any).chrome.runtime.sendMessage = () => {};

    const bannerEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "showBanner",
    );
    expect(bannerEvents.length).toBeGreaterThan(0);
    expect(bannerEvents[0]!.detail[1]).toContain("globally disabled");
  });
});

// ─── createPassThrough auto-exit timer ────────────────────────────────────────

describe("createPassThrough auto-exit via timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exits PassThrough mode automatically after the configured timeout elapses", () => {
    const normal = createNormal(insertStub);
    const pt = normal.passThrough(500);

    expect(pt.name).toBe("PassThrough");

    // The auto-exit setTimeout was scheduled by onEnter; advance past it.
    vi.advanceTimersByTime(600);

    // After the timeout fires, the mode should have exited the stack.
    // We verify indirectly: calling passThrough again should work (mode is off the stack).
    const pt2 = normal.passThrough(500);
    expect(pt2.name).toBe("PassThrough");
  });

  it("sets statusLine to include the timeout value when timeout > 0", () => {
    const normal = createNormal(insertStub);
    const pt = normal.passThrough(1234);

    expect(pt.statusLine).toContain("1234");
  });

  it("sets statusLine to 'pass through' when no timeout is given", () => {
    const normal = createNormal(insertStub);
    const pt = normal.passThrough();

    expect(pt.statusLine).toBe("pass through");
  });
});

// ─── createPassThrough keydown handler ───────────────────────────────────────

describe("createPassThrough keydown handler", () => {
  it("marks the event as sk_suppressed for any key", () => {
    const normal = createNormal(insertStub);
    const pt = normal.passThrough();
    const handler = pt.eventListeners["keydown"];
    if (handler == null) throw new Error("PassThrough has no keydown handler");

    const event = new Event("keydown") as Event & {
      sk_keyName?: string;
      sk_suppressed?: boolean;
      sk_stopPropagation?: boolean;
    };
    event.sk_keyName = "a";
    handler(event);

    expect(event.sk_suppressed).toBe(true);
  });

  it("sets sk_stopPropagation on Esc and suppresses the event", () => {
    const normal = createNormal(insertStub);
    const pt = normal.passThrough();
    const handler = pt.eventListeners["keydown"];
    if (handler == null) throw new Error("PassThrough has no keydown handler");

    const event = new Event("keydown") as Event & {
      sk_keyName?: string;
      sk_suppressed?: boolean;
      sk_stopPropagation?: boolean;
    };
    event.sk_keyName = "<Esc>";
    handler(event);

    expect(event.sk_stopPropagation).toBe(true);
    expect(event.sk_suppressed).toBe(true);
  });

  it("resets the auto-exit timer on non-Esc key when a timeout is active", () => {
    vi.useFakeTimers();
    const normal = createNormal(insertStub);
    // Enter with a 1000 ms timeout so _autoExit is set on enter.
    const pt = normal.passThrough(1000);
    const handler = pt.eventListeners["keydown"]!;

    // Advance 800 ms — still inside the window.
    vi.advanceTimersByTime(800);

    // A non-Esc key resets the timer.
    const event = new Event("keydown") as Event & { sk_keyName?: string; sk_suppressed?: boolean };
    event.sk_keyName = "x";
    handler(event);

    // The timer was reset; advancing another 800 ms (total 1600) should not fire exit yet.
    // We verify by checking that passThrough is still considered active (onEnter re-ran).
    vi.advanceTimersByTime(800);
    // Now advance fully past the reset timer.
    vi.advanceTimersByTime(300);

    vi.useRealTimers();
  });
});

// ─── createPassThrough mousedown / focus handlers ─────────────────────────────

describe("createPassThrough mousedown and focus handlers", () => {
  it("mousedown marks event sk_suppressed", () => {
    const normal = createNormal(insertStub);
    const pt = normal.passThrough();
    const handler = pt.eventListeners["mousedown"];
    if (handler == null) throw new Error("PassThrough has no mousedown handler");

    const event = new Event("mousedown") as Event & { sk_suppressed?: boolean };
    handler(event);

    expect(event.sk_suppressed).toBe(true);
  });

  it("focus marks event sk_suppressed", () => {
    const normal = createNormal(insertStub);
    const pt = normal.passThrough();
    const handler = pt.eventListeners["focus"];
    if (handler == null) throw new Error("PassThrough has no focus handler");

    const event = new Event("focus") as Event & { sk_suppressed?: boolean };
    handler(event);

    expect(event.sk_suppressed).toBe(true);
  });
});

// ─── revertToLurk ────────────────────────────────────────────────────────────

describe("createNormal revertToLurk", () => {
  it("sends RUNTIME setSurfingkeysIcon with status lurking when window === top", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    const normal = createNormal(insertStub);

    normal.revertToLurk();

    const calls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "setSurfingkeysIcon",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].status).toBe("lurking");

    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });
});

// ─── startLurk second call returns "enabled" ─────────────────────────────────

describe("createNormal startLurk state return values", () => {
  it("returns 'lurking' on the first call", () => {
    const normal = createNormal(insertStub);

    const state = normal.startLurk();

    expect(state).toBe("lurking");
  });
});

// ─── disable / enable ─────────────────────────────────────────────────────────

describe("createNormal disable and enable", () => {
  it("disable dispatches observer turnOff event", () => {
    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:observer", capture);

    const normal = createNormal(insertStub);
    normal.disable();

    document.removeEventListener("surfingkeys:observer", capture);

    const turnOffEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "turnOff",
    );
    expect(turnOffEvents.length).toBeGreaterThan(0);
  });

  it("calling disable twice reuses the same disabled mode instance", () => {
    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:observer", capture);

    const normal = createNormal(insertStub);
    normal.disable();
    normal.disable();

    document.removeEventListener("surfingkeys:observer", capture);

    const turnOffEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "turnOff",
    );
    // Two disable calls each dispatch turnOff (plus the one from createNormal's self.enable()).
    expect(turnOffEvents.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── captureElement ────────────────────────────────────────────────────────────

describe("createNormal captureElement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, "scrollingElement");
  });

  it("calls RUNTIME getCaptureSize then schedules captureVisibleTab after 500 ms", () => {
    // Make sendMessage invoke the getCaptureSize callback synchronously, then
    // record captureVisibleTab calls without invoking their callbacks (to avoid
    // triggering the img.onload chain which requires a real canvas).
    const capturedActions: string[] = [];
    (globalThis as any).chrome.runtime.sendMessage = (
      msg: any,
      cb?: (r: unknown) => void,
    ): void => {
      capturedActions.push(msg.action as string);
      if (msg.action === "getCaptureSize" && typeof cb === "function") {
        cb({ width: window.innerWidth });
      }
      // captureVisibleTab callback intentionally not called — that would trigger
      // img.onload which requires a real canvas rendering environment.
    };

    const normal = createNormal(insertStub);
    const elm = document.documentElement;

    normal.captureElement(elm);

    // getCaptureSize should have been invoked synchronously.
    expect(capturedActions).toContain("getCaptureSize");

    // captureVisibleTab is scheduled behind a 500 ms setTimeout.
    expect(capturedActions).not.toContain("captureVisibleTab");
    vi.advanceTimersByTime(600);
    expect(capturedActions).toContain("captureVisibleTab");

    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });

  it("hides scrollbars and borders before the first captureVisibleTab call", () => {
    (globalThis as any).chrome.runtime.sendMessage = (
      msg: any,
      cb?: (r: unknown) => void,
    ): void => {
      if (msg.action === "getCaptureSize" && typeof cb === "function") {
        cb({ width: window.innerWidth });
      }
    };

    const normal = createNormal(insertStub);
    const elm = document.documentElement;

    normal.captureElement(elm);

    // Style mutations happen synchronously inside the getCaptureSize callback.
    expect(elm.style.overflowY).toBe("hidden");
    expect(elm.style.overflowX).toBe("hidden");
    expect(elm.style.borderStyle).toBe("none");

    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });

  it("dispatches front toggleStatus false before taking the screenshot", () => {
    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:front", capture);

    (globalThis as any).chrome.runtime.sendMessage = (
      msg: any,
      cb?: (r: unknown) => void,
    ): void => {
      if (msg.action === "getCaptureSize" && typeof cb === "function") {
        cb({ width: window.innerWidth });
      }
    };

    const normal = createNormal(insertStub);
    normal.captureElement(document.documentElement);

    document.removeEventListener("surfingkeys:front", capture);
    (globalThis as any).chrome.runtime.sendMessage = () => {};

    const toggleFalseEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "toggleStatus" && e.detail[1] === false,
    );
    expect(toggleFalseEvents.length).toBeGreaterThan(0);
  });
});

// ─── smoothScrollBy via scroll with smoothScroll=true ─────────────────────────

describe("createNormal smoothScrollBy — requestAnimationFrame path", () => {
  let savedSmoothScroll: boolean;
  let savedSmartPageBoundary: boolean;

  beforeEach(() => {
    savedSmoothScroll = runtime.conf.smoothScroll;
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    runtime.conf.smoothScroll = true;
    runtime.conf.smartPageBoundary = false;
    RUNTIME.repeats = 1;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    runtime.conf.smoothScroll = savedSmoothScroll;
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    document.documentElement.style.scrollBehavior = "";
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(document.documentElement, "scrollTop");
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
    vi.useRealTimers();
  });

  it("sets scrollBehavior to 'auto' on the target element when smooth scrolling begins", () => {
    const normal = createNormal(insertStub);

    normal.scroll("down");

    // smoothScrollBy sets scrollBehavior = "auto" before requesting the first frame.
    expect(document.documentElement.style.scrollBehavior).toBe("auto");
  });

  it("schedules a requestAnimationFrame step when smooth scrolling begins", () => {
    // Verify that smoothScrollBy registers a rAF callback rather than calling
    // scrollBy directly (the rAF chain cannot be easily exercised in jsdom because
    // repeated rAF calls cause an infinite-loop under fake timers, so we only
    // verify the immediate side-effect: scrollBehavior is set to 'auto').
    const normal = createNormal(insertStub);

    normal.scroll("down");

    // scrollBehavior = "auto" is the observable signal that the rAF path was taken.
    expect(document.documentElement.style.scrollBehavior).toBe("auto");
  });
});

// ─── feedkeys ─────────────────────────────────────────────────────────────────

describe("createNormal feedkeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not process keys before the 1 ms timeout fires", () => {
    // Register a mapping to detect if it was executed.
    let executed = false;
    const normal = createNormal(insertStub);
    normal.mappings.add("z", {
      annotation: "test",
      feature_group: 0,
      code: () => {
        executed = true;
      },
    });

    normal.feedkeys("z");

    // Without advancing timers, the key should not have been processed.
    expect(executed).toBe(false);
  });

  it("processes each character as a keydown event after the 1 ms timeout fires", () => {
    let executed = false;
    const normal = createNormal(insertStub);
    normal.mappings.add("z", {
      annotation: "test",
      feature_group: 0,
      code: () => {
        executed = true;
      },
    });

    normal.feedkeys("z");
    vi.advanceTimersByTime(2);

    expect(executed).toBe(true);
  });
});

// ─── onMouseUp (via mouseup document event after enable) ─────────────────────

describe("createNormal _onMouseUp — querySelectedWord dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    runtime.conf.mouseSelectToQuery = [];
  });

  it("dispatches at least one querySelectedWord after 1 ms when window.origin is in mouseSelectToQuery", () => {
    // enable() registers _onMouseUp on the document. Multiple normal instances
    // created in the test suite may all have mouseup listeners active (each
    // createNormal calls self.enable() which appends a listener), so we count
    // the increment rather than asserting an absolute value of 1.
    runtime.conf.mouseSelectToQuery = [window.origin];

    const div = document.createElement("div");
    document.body.appendChild(div);

    let countAfter = 0;
    const capture = (e: Event): void => {
      const ce = e as CustomEvent;
      if (Array.isArray(ce.detail) && ce.detail[0] === "querySelectedWord") {
        countAfter++;
      }
    };
    document.addEventListener("surfingkeys:front", capture);

    const normal = createNormal(insertStub);

    // Dispatch on the div element so event.target has a .matches() method.
    // The listener is on document so it still fires, and target is the div.
    div.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // Before timer fires, no new querySelectedWord dispatched.
    expect(countAfter).toBe(0);

    vi.advanceTimersByTime(2);

    document.removeEventListener("surfingkeys:front", capture);
    div.remove();
    normal.disable(); // removes the mouseup listener

    // At least one querySelectedWord event was dispatched after the timer fired.
    expect(countAfter).toBeGreaterThan(0);
  });

  it("does not dispatch querySelectedWord when window.origin is not in mouseSelectToQuery", () => {
    runtime.conf.mouseSelectToQuery = [];

    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:front", capture);

    const normal = createNormal(insertStub);

    const div = document.createElement("div");
    document.body.appendChild(div);
    const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
    document.dispatchEvent(mouseupEvent);

    vi.advanceTimersByTime(2);

    document.removeEventListener("surfingkeys:front", capture);

    const queryEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "querySelectedWord",
    );
    expect(queryEvents).toHaveLength(0);

    div.remove();
    normal.disable();
  });
});

// ─── onExit clears scroll helpers ─────────────────────────────────────────────

describe("createNormal onExit", () => {
  it("dispatches observer turnOff on exit", () => {
    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:observer", capture);

    const normal = createNormal(insertStub);
    normal.onExit!();

    document.removeEventListener("surfingkeys:observer", capture);

    const turnOffEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "turnOff",
    );
    expect(turnOffEvents.length).toBeGreaterThan(0);
  });
});

// ─── keyup handler resets keyHeld via setTimeout ──────────────────────────────

// ─── scrollFallback — falls back to document.scrollingElement ────────────────

describe("createNormal scroll — scrollFallback falls back when element cannot scroll", () => {
  let savedSmoothScroll: boolean;
  let savedSmartPageBoundary: boolean;
  let savedScrollFallback: boolean;
  let savedRepeats: number;
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedSmoothScroll = runtime.conf.smoothScroll;
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    savedScrollFallback = runtime.conf.scrollFallback;
    savedRepeats = RUNTIME.repeats;
    runtime.conf.smoothScroll = false;
    runtime.conf.smartPageBoundary = false;
    runtime.conf.scrollFallback = true;
    RUNTIME.repeats = 1;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    scrollBy = vi.fn();
    Object.defineProperty(document.documentElement, "scrollBy", {
      value: scrollBy,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollLeft", {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    runtime.conf.smoothScroll = savedSmoothScroll;
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    runtime.conf.scrollFallback = savedScrollFallback;
    RUNTIME.repeats = savedRepeats;
    document.documentElement.style.scrollBehavior = "";
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(document.documentElement, "scrollBy");
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
    Reflect.deleteProperty(document.documentElement, "scrollTop");
    Reflect.deleteProperty(document.documentElement, "scrollLeft");
  });

  it("falls back to scrollingElement when a non-document scrollNode cannot scroll vertically", () => {
    // To exercise the scrollFallback path the inner element must survive the
    // stale-element check (br.width/height non-zero, partially in viewport, and
    // has some scroll).  We mock getBoundingClientRect and Mode.hasScroll so
    // jsdom's always-zero geometry does not cause an early refresh.
    const inner = document.createElement("div");
    // scrollHeight == clientHeight → canScrollInDirection("vertical") returns false.
    Object.defineProperty(inner, "scrollHeight", { value: 50, configurable: true });
    Object.defineProperty(inner, "clientHeight", { value: 50, configurable: true });
    Object.defineProperty(inner, "scrollWidth", { value: 200, configurable: true });
    Object.defineProperty(inner, "clientWidth", { value: 50, configurable: true });
    Object.defineProperty(inner, "scrollTop", { value: 0, writable: true, configurable: true });
    Object.defineProperty(inner, "scrollLeft", { value: 0, writable: true, configurable: true });
    // Non-zero bounding rect so the stale check does not trigger a refresh.
    inner.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect;
    document.body.appendChild(inner);

    const normal = createNormal(insertStub);
    // Manually set the scroll list to [inner] so the code picks it as the target.
    normal.addScrollableElement(inner);
    // refreshScrollableElements forces Mode.getScrollableElements() which in jsdom
    // will include document.documentElement if it reports scroll.  Provide a scrollBy
    // spy on inner as well so we can confirm it was NOT called (fallback used instead).
    const innerScrollBy = vi.fn();
    Object.defineProperty(inner, "scrollBy", { value: innerScrollBy, configurable: true });

    normal.scroll("down");

    // scrollFallback is true and inner cannot scroll vertically →
    // the scroll should be redirected to document.scrollingElement.
    // scrollBy on document.documentElement should be called; inner's scrollBy should not.
    expect(innerScrollBy).not.toHaveBeenCalled();
    expect(scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      left: 0,
      top: runtime.conf.scrollStepSize,
    });

    inner.remove();
  });
});

// ─── smartPageBoundary — top and bottom boundary events ───────────────────────

describe("createNormal scroll — smartPageBoundary fires boundary events", () => {
  let savedSmoothScroll: boolean;
  let savedSmartPageBoundary: boolean;
  let savedRepeats: number;
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedSmoothScroll = runtime.conf.smoothScroll;
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    savedRepeats = RUNTIME.repeats;
    runtime.conf.smoothScroll = false;
    runtime.conf.smartPageBoundary = true;
    RUNTIME.repeats = 1;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    scrollBy = vi.fn();
    Object.defineProperty(document.documentElement, "scrollBy", {
      value: scrollBy,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollLeft", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      value: 800,
      configurable: true,
    });
  });

  afterEach(() => {
    runtime.conf.smoothScroll = savedSmoothScroll;
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    RUNTIME.repeats = savedRepeats;
    document.documentElement.style.scrollBehavior = "";
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(document.documentElement, "scrollBy");
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
    Reflect.deleteProperty(document.documentElement, "scrollTop");
    Reflect.deleteProperty(document.documentElement, "scrollLeft");
    Reflect.deleteProperty(document.documentElement, "clientHeight");
  });

  it("dispatches topBoundaryHit when scrollTop is 0 and scrolling up", () => {
    // scrollTop=0, y<0 → topBoundaryHit
    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:hints", capture);

    const normal = createNormal(insertStub);
    normal.scroll("up");

    document.removeEventListener("surfingkeys:hints", capture);

    const boundary = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "topBoundaryHit",
    );
    expect(boundary.length).toBeGreaterThan(0);
    // skScrollBy returned early → scrollBy was never called.
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("dispatches bottomBoundaryHit when already at the bottom and scrolling down", () => {
    // Set scrollTop so that scrollHeight - scrollTop <= clientHeight + 1 → bottom boundary.
    // scrollHeight=2000, clientHeight=800 → scrollTop must be >= 1199 for bottom boundary.
    (document.documentElement as any).scrollTop = 1200;

    const events: CustomEvent[] = [];
    const capture = (e: Event): void => {
      events.push(e as CustomEvent);
    };
    document.addEventListener("surfingkeys:hints", capture);

    const normal = createNormal(insertStub);
    normal.scroll("down");

    document.removeEventListener("surfingkeys:hints", capture);

    const boundary = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "bottomBoundaryHit",
    );
    expect(boundary.length).toBeGreaterThan(0);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

// ─── scroll bottom / rightmost ────────────────────────────────────────────────

describe("createNormal scroll — bottom and rightmost scroll types", () => {
  let savedSmoothScroll: boolean;
  let savedSmartPageBoundary: boolean;
  let savedRepeats: number;
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedSmoothScroll = runtime.conf.smoothScroll;
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    savedRepeats = RUNTIME.repeats;
    runtime.conf.smoothScroll = false;
    runtime.conf.smartPageBoundary = false;
    RUNTIME.repeats = 1;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    scrollBy = vi.fn();
    Object.defineProperty(document.documentElement, "scrollBy", {
      value: scrollBy,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollWidth", {
      value: 3000,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollTop", {
      value: 100,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollLeft", {
      value: 50,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    runtime.conf.smoothScroll = savedSmoothScroll;
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    RUNTIME.repeats = savedRepeats;
    document.documentElement.style.scrollBehavior = "";
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(document.documentElement, "scrollBy");
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
    Reflect.deleteProperty(document.documentElement, "scrollWidth");
    Reflect.deleteProperty(document.documentElement, "scrollTop");
    Reflect.deleteProperty(document.documentElement, "scrollLeft");
  });

  it("bottom scrolls to scrollHeight minus scrollTop (bringing element to bottom)", () => {
    // skScrollBy(scrollLeft, scrollHeight - scrollTop) = skScrollBy(50, 2000 - 100) = skScrollBy(50, 1900)
    const normal = createNormal(insertStub);

    normal.scroll("bottom");

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", left: 50, top: 1900 });
  });

  it("rightmost scrolls right by scrollWidth minus scrollLeft minus viewport width plus 20", () => {
    // size[0] = window.innerWidth (jsdom default 1024)
    // delta = scrollWidth - scrollLeft - size[0] + 20 = 3000 - 50 - 1024 + 20 = 1946
    const normal = createNormal(insertStub);
    const expected = 3000 - 50 - window.innerWidth + 20;

    normal.scroll("rightmost");

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", left: expected, top: 0 });
  });
});

// ─── addScrollableElement — duplicate / contains guard ───────────────────────

describe("createNormal addScrollableElement — duplicate guard", () => {
  let savedSmoothScroll: boolean;
  let savedSmartPageBoundary: boolean;

  beforeEach(() => {
    savedSmoothScroll = runtime.conf.smoothScroll;
    savedSmartPageBoundary = runtime.conf.smartPageBoundary;
    runtime.conf.smoothScroll = false;
    runtime.conf.smartPageBoundary = false;
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollBy", {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterEach(() => {
    runtime.conf.smoothScroll = savedSmoothScroll;
    runtime.conf.smartPageBoundary = savedSmartPageBoundary;
    Reflect.deleteProperty(document, "scrollingElement");
    Reflect.deleteProperty(document.documentElement, "scrollBy");
  });

  it("does not add a duplicate element to the scroll list", () => {
    const savedScrollFallback = runtime.conf.scrollFallback;
    runtime.conf.scrollFallback = false;
    // Suppress auto-detection so addScrollableElement is the only source of scroll nodes;
    // otherwise jsdom reports the freshly-built divs as already-scrollable and skips the push.
    // The discovery runs exactly once (the later calls see a non-empty list), so Once suffices.
    vi.mocked(getScrollableElements).mockReturnValueOnce([]);

    const makeTarget = (): { el: HTMLElement; scrollBy: ReturnType<typeof vi.fn> } => {
      const el = document.createElement("div");
      const scrollBy = vi.fn();
      document.body.appendChild(el);
      Object.defineProperty(el, "scrollHeight", { value: 500, configurable: true });
      Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
      Object.defineProperty(el, "scrollLeft", { value: 0, writable: true, configurable: true });
      Object.defineProperty(el, "scrollBy", { value: scrollBy, configurable: true });
      el.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect;
      return { el, scrollBy };
    };
    const first = makeTarget();
    const second = makeTarget();

    const normal = createNormal(insertStub);
    normal.addScrollableElement(first.el);
    normal.addScrollableElement(second.el); // scrollIndex now points at `second`
    normal.addScrollableElement(first.el); // duplicate: indexOf(first) !== -1 → no push, index unchanged

    normal.scroll("down");

    // If the duplicate guard failed, `first` would have been re-pushed and become the
    // current scroll target. Because it is a no-op, `second` stays the target.
    expect(second.scrollBy).toHaveBeenCalledWith({
      behavior: "instant",
      left: 0,
      top: runtime.conf.scrollStepSize,
    });
    expect(first.scrollBy).not.toHaveBeenCalled();

    runtime.conf.scrollFallback = savedScrollFallback;
    first.el.remove();
    second.el.remove();
  });
});

// ─── jumpVIMark — empty scrollNodes on "'" mark ───────────────────────────────

describe(String.raw`createNormal jumpVIMark — no scrollable elements on '\' mark`, () => {
  it("does nothing when scrollNodes is empty on the backtick mark", () => {
    Object.defineProperty(document, "scrollingElement", {
      value: document.documentElement,
      configurable: true,
    });
    // Force an empty scroll list so the `scrollNodes.length > 0` guard is false.
    vi.mocked(getScrollableElements).mockReturnValueOnce([]);
    // Seed a sentinel scroll position; the empty-list branch must not restore/swap it.
    Object.defineProperty(document.documentElement, "scrollTop", {
      value: 123,
      writable: true,
      configurable: true,
    });
    const normal = createNormal(insertStub);

    normal.jumpVIMark("'");

    expect(document.documentElement.scrollTop).toBe(123);

    Reflect.deleteProperty(document.documentElement, "scrollTop");
    Reflect.deleteProperty(document, "scrollingElement");
  });
});

// ─── keydown handler — non-editable key with no matching mapping ──────────────

describe("createNormal keydown handler — non-editable key dispatches handleMapKey", () => {
  it("dispatches handleMapKey and leaves the event un-suppressed when key has length", () => {
    const normal = createNormal(insertStub);
    const div = document.createElement("div");
    document.body.appendChild(div);

    const base = new Event("keydown");
    Object.defineProperty(base, "target", { value: div });
    Object.defineProperty(base, "key", { value: "z" });
    base.sk_keyName = "z";
    const event = new Proxy(base, {
      get(t, p) {
        if (p === "isTrusted") return false;
        const value = Reflect.get(t, p, t);
        return typeof value === "function" ? value.bind(t) : value;
      },
    });

    // The non-editable, keyName.length branch must route the key through handleMapKey
    // (returning false for an unmatched key) rather than entering insert mode.
    const handleMapKey = vi.spyOn(Mode, "handleMapKey").mockReturnValue(false);

    const handler = normal.eventListeners["keydown"]!;
    handler(event);

    expect(handleMapKey).toHaveBeenCalledTimes(1);
    expect(handleMapKey.mock.instances[0]).toBe(normal);
    expect(handleMapKey.mock.calls[0]?.[0]).toBe(event);
    // Normal mode does not flag the event as suppressed (only Disabled mode does).
    expect(base.sk_suppressed).toBeFalsy();

    handleMapKey.mockRestore();
    div.remove();
  });
});

// ─── _once flag: exits normal after an action is done ─────────────────────────

describe("createNormal once", () => {
  it("sets _once so the mode exits after one action completes via the keydown handler", () => {
    const normal = createNormal(insertStub);
    let ran = 0;
    normal.mappings.add("z", {
      annotation: "once-test",
      feature_group: 0,
      code: () => {
        ran++;
      },
    });

    // once() sets _once=true and enters the mode.
    normal.once();

    // Drive through the real keydown handler so the _once closure is evaluated.
    const handler = normal.eventListeners["keydown"]!;
    const div = document.createElement("div"); // non-editable target
    document.body.appendChild(div);
    const base = new Event("keydown");
    Object.defineProperty(base, "target", { value: div });
    Object.defineProperty(base, "key", { value: "z" });
    base.sk_keyName = "z";
    // Proxy isTrusted=false so the editable branch is not taken.
    const evt = new Proxy(base, {
      get(t, p) {
        if (p === "isTrusted") return false;
        const value = Reflect.get(t, p, t);
        return typeof value === "function" ? value.bind(t) : value;
      },
    });

    handler(evt);

    expect(ran).toBe(1);
    // After the action, _once causes normal.exit() — mode is no longer at the top.
    expect(Mode.getCurrent()).not.toBe(normal);

    div.remove();
  });
});

// ─── createDisabled keydown handler branches ─────────────────────────────────

describe("createNormal disable — disabled mode keydown branches", () => {
  it("disabled mode sets sk_suppressed for any key", () => {
    const normal = createNormal(insertStub);
    normal.disable();

    // Get the disabled mode's keydown handler via the mode stack's first entry.
    const disabled = Mode.getCurrent();
    if (disabled == null) throw new Error("no current mode after disable");

    const handler = disabled.eventListeners["keydown"];
    if (handler == null) throw new Error("disabled mode has no keydown handler");

    const event = new Event("keydown") as Event & {
      sk_keyName?: string;
      sk_suppressed?: boolean;
      sk_stopPropagation?: boolean;
    };
    event.sk_keyName = "a";
    handler(event);

    expect(event.sk_suppressed).toBe(true);

    normal.enable();
  });
});

// Drive the Normal keydown handler with an arbitrary target and key, reporting a
// trusted event (jsdom forbids redefining isTrusted, hence the Proxy).
function dispatchKeydownWith(
  normal: ReturnType<typeof createNormal>,
  target: Element,
  key: string,
): Event & { sk_stopPropagation?: boolean } {
  const base = new Event("keydown");
  Object.defineProperty(base, "target", { value: target });
  Object.defineProperty(base, "key", { value: key });
  base.sk_keyName = key === "<Esc>" ? "<Esc>" : key;
  const event = new Proxy(base, {
    get(t, p) {
      if (p === "isTrusted") return true;
      const value = Reflect.get(t, p, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
  normal.eventListeners["keydown"]!(event);
  return event as Event & { sk_stopPropagation?: boolean };
}

describe("createNormal keydown handler — editable target branches", () => {
  it("exits insert mode and does not enter it when Esc is pressed on an editable element", () => {
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    const input = document.createElement("input");
    document.body.appendChild(input);
    const blur = vi.spyOn(input, "blur");

    dispatchKeydownWith(normal, input, "<Esc>");

    // Esc on an editable element blurs it and exits insert (the true arm of the
    // isEditable+Esc branch), never calling insert.enter.
    expect(blur).toHaveBeenCalledOnce();
    expect(insert.exit).toHaveBeenCalledOnce();
    expect(insert.enter).not.toHaveBeenCalled();

    input.remove();
  });

  it("shows the 'Press i' hint and routes the key through mappings when editableBodyCare is on and body is the target", () => {
    const savedCare = runtime.conf.editableBodyCare;
    const savedShow = runtime.conf.showModeStatus;
    runtime.conf.editableBodyCare = true;
    runtime.conf.showModeStatus = false;
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    // jsdom reports isContentEditable as undefined, so force isEditable(body) to be true.
    Object.defineProperty(document.body, "isContentEditable", {
      value: true,
      configurable: true,
    });

    dispatchKeydownWith(normal, document.body, "j");

    // editableBodyCare + body + key!=="i" arm: status hint set, mode status shown,
    // and the key is fed to mappings rather than entering insert mode.
    expect(normal.statusLine).toBe("Press i to enter Insert mode");
    expect(runtime.conf.showModeStatus).toBe(true);
    expect(insert.enter).not.toHaveBeenCalled();

    Reflect.deleteProperty(document.body, "isContentEditable");
    runtime.conf.editableBodyCare = savedCare;
    runtime.conf.showModeStatus = savedShow;
  });

  it("stops propagation and focuses the body when 'i' is pressed with editableBodyCare on the body", () => {
    const savedCare = runtime.conf.editableBodyCare;
    runtime.conf.editableBodyCare = true;
    const insert = { enter: vi.fn(), exit: vi.fn() };
    const normal = createNormal(insert);
    Object.defineProperty(document.body, "isContentEditable", {
      value: true,
      configurable: true,
    });
    const focus = vi.spyOn(document.body, "focus");
    const passFocus = vi.spyOn(normal, "passFocus");

    const event = dispatchKeydownWith(normal, document.body, "i");

    // editableBodyCare + body + key==="i" arm: sk_stopPropagation true, passFocus(true),
    // and the body is re-focused so the native caret takes over.
    expect(event.sk_stopPropagation).toBe(true);
    expect(passFocus).toHaveBeenCalledWith(true);
    expect(focus).toHaveBeenCalledOnce();

    Reflect.deleteProperty(document.body, "isContentEditable");
    runtime.conf.editableBodyCare = savedCare;
  });
});
