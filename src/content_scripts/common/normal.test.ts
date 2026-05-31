import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markAutoFocus } from "./domFlags";
import createNormal from "./normal";
import { runtime } from "./runtime";

const insertStub = { enter() {}, exit() {} };

function dispatchFocus(normal: ReturnType<typeof createNormal>, target: Element): Event {
  const event = new Event("focus");
  Object.defineProperty(event, "target", { value: target });
  normal.eventListeners.focus(event);
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
