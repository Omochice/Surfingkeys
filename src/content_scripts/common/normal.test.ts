import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markAutoFocus, markNewlyCreated } from "./domFlags";
import createNormal from "./normal";
import { RUNTIME, runtime } from "./runtime";

const insertStub = { enter() {}, exit() {} };

function dispatchFocus(normal: ReturnType<typeof createNormal>, target: Element): Event {
  const event = new Event("focus");
  Object.defineProperty(event, "target", { value: target });
  const handler = normal.eventListeners["focus"];
  if (handler === undefined) {
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
  if (handler === undefined) {
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
