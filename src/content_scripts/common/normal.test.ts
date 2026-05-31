import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markAutoFocus, markNewlyCreated } from "./domFlags";
import createNormal from "./normal";
import { runtime } from "./runtime";

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
    get(t, p, r) {
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
