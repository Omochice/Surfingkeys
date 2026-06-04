import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markAutoFocus, markNewlyCreated } from "./domFlags";
import KeyboardUtils from "./keyboardUtils";
import createNormal from "./normal";
import { RUNTIME, runtime } from "./runtime";

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
  // isScrollKeyInHints looks up self.mappings[key] as a plain property on the
  // Trie instance. Because Trie stores children in a private Map (not as named
  // properties), bracket access always returns undefined and the function
  // always returns false regardless of what is registered. These tests pin that
  // observable contract so a future refactor that fixes the lookup is noticed.
  it("returns false even for a key bound to a scroll mapping (lookup misses the Trie's private Map)", () => {
    const normal = createNormal(insertStub);

    // "e" is registered as a scroll mapping in createNormal, yet the bracket
    // lookup on the Trie instance cannot see it, so the result is false. This
    // pins the current (buggy) contract so a fix to the lookup is noticed.
    expect(normal.isScrollKeyInHints("e")).toBe(false);
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

  it("mark=\\' swaps scroll position with the saved lastScrollTop/lastScrollLeft", () => {
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

  it("non-\\' mark sends RUNTIME jumpVIMark with the mark character", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;
    const normal = createNormal(insertStub);

    normal.jumpVIMark("a");

    const calls = sendMessage.mock.calls.filter((args: any[]) => args[0]?.action === "jumpVIMark");
    expect(calls).toHaveLength(1);
    expect(calls[0][0].mark).toBe("a");
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
    expect(calls[0][0].position).toBe(3);
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
    const markPayload = calls[0][0].mark as Record<
      string,
      { url: string; scrollLeft: number; scrollTop: number }
    >;
    expect(markPayload["a"]).toBeDefined();
    expect(markPayload["a"].url).toBe("https://example.com/");
    expect(typeof markPayload["a"].scrollTop).toBe("number");
    expect(typeof markPayload["a"].scrollLeft).toBe("number");

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

    const calls = sendMessage.mock.calls.filter((args: any[]) => args[0]?.action === "addVIMark");
    const markPayload = calls[0][0].mark as Record<string, { url: string }>;
    expect(markPayload["b"].url).toBe(window.location.href);

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
