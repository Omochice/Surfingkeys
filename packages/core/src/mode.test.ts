import { Result } from "@praha/byethrow";
import { expectDefined } from "@sk/test-support/helpers";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineEnv } from "./engineEnv";
import {
  ModeHandle,
  beginBufferingKeyEvents,
  checkEventListener,
  getCurrentMode,
  initModeHub,
  releaseBufferedKeyEvents,
  suppressKeyUp,
} from "./mode";

// A complete EngineEnv whose chrome-facing members are inert stubs; mode.ts only exercises
// isInUIFrame and reportIssue, so tests override just those.
function makeTestEnv(overrides: Partial<EngineEnv> = {}): EngineEnv {
  return {
    RUNTIME: () => Result.succeed(undefined),
    isInUIFrame: () => false,
    reportIssue: vi.fn(),
    tabOpenLink: () => {},
    getExtensionURL: (path: string) => path,
    log: () => {},
    surfingkeys: undefined,
    ...overrides,
  };
}

function makeMode(name = "Test"): ModeHandle {
  return new ModeHandle(name);
}

// The mode stack, the window listeners and the settings-ready flag are module-level state that a
// test would otherwise inherit from whichever test happened to run before it.
beforeEach(() => {
  initModeHub(makeTestEnv());
  releaseBufferedKeyEvents();
});

describe("suppressKeyUp", () => {
  it("swallows the next keyup for the keyCode exactly once, however often it was suppressed", () => {
    const mode = makeMode("Normal");
    mode.enter(1);

    suppressKeyUp(90);
    suppressKeyUp(90);

    const first = new Event("keyup");
    Object.defineProperty(first, "keyCode", { value: 90 });
    const firstStop = vi.spyOn(first, "stopImmediatePropagation");
    window.dispatchEvent(first);
    expect(firstStop).toHaveBeenCalled();

    const second = new Event("keyup");
    Object.defineProperty(second, "keyCode", { value: 90 });
    const secondStop = vi.spyOn(second, "stopImmediatePropagation");
    window.dispatchEvent(second);
    expect(secondStop).not.toHaveBeenCalled();

    mode.exit();
  });
});

describe("ModeHandle enter / exit / getCurrentMode", () => {
  // Each test must leave the mode_stack clean.  We do this by explicitly
  // exiting every mode entered during the test.
  it("getCurrent returns the mode at the top of the stack after enter", () => {
    const mode = makeMode("A");
    mode.enter(10);
    expect(getCurrentMode()).toBe(mode);
    mode.exit();
  });

  it("getCurrent returns undefined once the stack is fully cleared", () => {
    // Deterministically drain any modes left on the shared stack by prior tests,
    // then assert the empty-stack contract. exit() removes the current mode and
    // every mode above it, so this loop terminates; the final assertion fails
    // loudly if any mode is still present.
    let guard = 0;
    while (getCurrentMode() !== undefined && guard < 100) {
      getCurrentMode()!.exit();
      guard++;
    }
    expect(getCurrentMode()).toBeUndefined();
  });

  it("exit with peek removes only the targeted mode, leaving modes above it", () => {
    const modeA = makeMode("A");
    const modeB = makeMode("B");

    modeA.enter(5);
    modeB.enter(10);

    expect(getCurrentMode()).toBe(modeB);

    modeA.exit(true);
    expect(getCurrentMode()).toBe(modeB);

    modeB.exit();
  });

  it("exit without peek removes the mode and all modes above it", () => {
    const modeA = makeMode("A");
    const modeB = makeMode("B");

    modeA.enter(5);
    modeB.enter(10);

    modeA.exit();
    expect(getCurrentMode()).not.toBe(modeB);
    expect(getCurrentMode()).not.toBe(modeA);
  });

  it("onEnter callback is called when entering a mode", () => {
    const mode = makeMode("CB");
    const onEnter = vi.fn();
    mode.onEnter = onEnter;

    mode.enter(1);
    expect(onEnter).toHaveBeenCalledOnce();
    mode.exit();
  });

  it("onExit callback receives the position the mode was at", () => {
    const mode = makeMode("CB2");
    let capturedPos: number | undefined;
    mode.onExit = (pos) => {
      capturedPos = pos;
    };

    mode.enter(1);
    mode.exit();
    expect(capturedPos).toBe(0);
  });

  it("priority controls sort order — higher priority mode becomes getCurrent", () => {
    const lowPri = makeMode("Low");
    const highPri = makeMode("High");

    lowPri.enter(1);
    highPri.enter(100);

    expect(getCurrentMode()).toBe(highPri);

    highPri.exit(true);
    lowPri.exit(true);
  });

  it("reentrant enter pops modes above the re-entered mode", () => {
    const base = makeMode("Base");
    const top = makeMode("Top");

    base.enter(1);
    top.enter(10);

    expect(getCurrentMode()).toBe(top);

    base.enter(undefined, true);
    expect(getCurrentMode()).toBe(base);

    base.exit();
  });
});

describe("ModeHandle.addEventListener", () => {
  it("registers an event listener on the mode and returns this", () => {
    const mode = makeMode("Evt");
    const handler = vi.fn();
    const ret = mode.addEventListener("custom", handler);
    expect(ret).toBe(mode);
    expect(mode.eventListeners["custom"]).toBe(handler);
  });
});

describe("initModeHub", () => {
  it("runs the callback immediately on a normal (non-blank) page", () => {
    const cb = vi.fn();
    initModeHub(makeTestEnv(), cb);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("checkEventListener", () => {
  it("does not call onMissing while the hub's sentinel listener is installed", () => {
    const onMissing = vi.fn();
    checkEventListener(onMissing);
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe("ModeHandle.enter — reentrant=false re-entry reports an issue and leaves the stack intact", () => {
  it("reports an issue and does not pop modes when a non-top mode is re-entered without reentrant", () => {
    const reportIssue = vi.fn();
    initModeHub(makeTestEnv({ reportIssue }));
    const lower = new ModeHandle("Lower");
    const upper = new ModeHandle("Upper");
    lower.enter(1);
    upper.enter(2);
    expect(getCurrentMode()).toBe(upper);

    // Re-enter the lower (non-top, pos > 0) mode without reentrant=true: the else
    // branch must call reportIssue and must NOT slice the stack down to `lower`.
    lower.enter(1, false);

    expect(reportIssue).toHaveBeenCalledTimes(1);
    expect(reportIssue).toHaveBeenCalledWith(
      "Mode Lower pushed into mode stack again.",
      expect.stringContaining("Modes in stack:"),
    );
    expect(getCurrentMode()).toBe(upper);

    upper.exit();
    lower.exit();
  });
});

describe("ModeHandle.addEventListener — registers a new global listened event", () => {
  it("routes a window event of a not-yet-listened type into the mode's handler", () => {
    const mode = makeMode("GlobalEvt");
    const handler = vi.fn();
    // "wheel" is not among the built-in listenedEvents, so addEventListener must
    // install a fresh window listener that funnels through handleStack.
    mode.addEventListener("wheel", handler);
    mode.enter();

    window.dispatchEvent(new Event("wheel"));

    expect(handler).toHaveBeenCalledTimes(1);

    mode.exit();
  });
});

describe("handleStack dispatch — suppression, stopPropagation and Disabled break", () => {
  afterEach(() => {
    // Pop any modes left on the stack between tests.
    for (let i = 0; i < 5; i++) {
      getCurrentMode()?.exit();
    }
  });

  it("skips a higher mode's listener and breaks when a Disabled mode is on top", () => {
    const lower = new ModeHandle("Normal");
    const lowerHandler = vi.fn();
    lower.addEventListener("keydown", lowerHandler);

    const disabled = new ModeHandle("Disabled");
    const disabledHandler = vi.fn((e: Event & { sk_suppressed?: boolean }) => {
      e.sk_suppressed = true;
    });
    disabled.addEventListener("keydown", disabledHandler);

    lower.enter(1);
    disabled.enter(2);

    const event = new Event("keydown") as Event & {
      sk_keyName?: string;
      sk_suppressed?: boolean;
    };
    window.dispatchEvent(event);

    expect(disabledHandler).toHaveBeenCalledTimes(1);
    expect(lowerHandler).not.toHaveBeenCalled();

    disabled.exit();
    lower.exit();
  });
});

describe("key buffering before user settings are applied", () => {
  afterEach(() => {
    for (let i = 0; i < 5; i++) {
      getCurrentMode()?.exit();
    }
    // Release the buffer so a later test is not left in the buffering state.
    document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsApplied"));
  });

  it("does not deliver a keydown to mode handlers before settings are applied", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();
    const mode = new ModeHandle("Normal");
    const handler = vi.fn();
    mode.addEventListener("keydown", handler);
    mode.enter(1);

    window.dispatchEvent(new Event("keydown"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers buffered keydown to handlers once settings are applied", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();
    const mode = new ModeHandle("Normal");
    const handler = vi.fn();
    mode.addEventListener("keydown", handler);
    mode.enter(1);

    window.dispatchEvent(new Event("keydown"));
    expect(handler).not.toHaveBeenCalled();

    document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsApplied"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps buffering while a snippet has yet to be applied", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();
    const mode = new ModeHandle("Normal");
    const handler = vi.fn();
    mode.addEventListener("keydown", handler);
    mode.enter(1);

    window.dispatchEvent(new Event("keydown"));

    // The stored settings have arrived, but a snippet applied by the MV3 user script may still
    // be about to override the built-in mapping this key would otherwise hit.
    document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsLoaded"));
    expect(handler).not.toHaveBeenCalled();

    document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsApplied"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("processes buffered keys in the order they were pressed", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();
    const mode = new ModeHandle("Normal");
    const seen: Event[] = [];
    mode.addEventListener("keydown", (e) => {
      seen.push(e);
    });
    mode.enter(1);

    const first = new Event("keydown");
    const second = new Event("keydown");
    window.dispatchEvent(first);
    window.dispatchEvent(second);

    document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsApplied"));
    expect(seen).toEqual([first, second]);
  });

  it("delivers keydown immediately once settings have been applied", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();
    document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsApplied"));
    const mode = new ModeHandle("Normal");
    const handler = vi.fn();
    mode.addEventListener("keydown", handler);
    mode.enter(1);

    window.dispatchEvent(new Event("keydown"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("buffers keyup until settings are applied, then delivers it", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();
    const mode = new ModeHandle("Normal");
    const handler = vi.fn();
    mode.addEventListener("keyup", handler);
    mode.enter(1);

    window.dispatchEvent(new Event("keyup"));
    expect(handler).not.toHaveBeenCalled();

    document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsApplied"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("clears the keyup-suppression entry when replaying a buffered keyup", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();
    const mode = new ModeHandle("Normal");
    // Mirror real handling: a handled keydown marks its matching keyup for suppression.
    mode.addEventListener("keydown", (e) => {
      suppressKeyUp(e.keyCode ?? -1);
    });
    mode.enter(1);

    const keydown = new Event("keydown");
    const keyup = new Event("keyup");
    Object.defineProperty(keydown, "keyCode", { value: 65 });
    Object.defineProperty(keyup, "keyCode", { value: 65 });
    window.dispatchEvent(keydown);
    window.dispatchEvent(keyup);

    releaseBufferedKeyEvents();

    // The buffered keyup must consume the suppression entry on replay; otherwise a
    // later, unrelated live keyup for the same key would be wrongly swallowed.
    const liveKeyup = new Event("keyup");
    Object.defineProperty(liveKeyup, "keyCode", { value: 65 });
    const stopImmediatePropagation = vi.spyOn(liveKeyup, "stopImmediatePropagation");
    window.dispatchEvent(liveKeyup);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();

    mode.exit();
  });

  it("removes the userSettingsApplied listener when the buffer is released", () => {
    initModeHub(makeTestEnv());
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    beginBufferingKeyEvents();
    const added = addEventListener.mock.calls.find(
      ([name]) => name === "surfingkeys:userSettingsApplied",
    );
    expectDefined(added);
    releaseBufferedKeyEvents();
    expect(removeEventListener).toHaveBeenCalledWith("surfingkeys:userSettingsApplied", added[1]);
    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });

  it("releases the buffer when released directly (e.g. settings fetch failed)", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();
    const mode = new ModeHandle("Normal");
    const handler = vi.fn();
    mode.addEventListener("keydown", handler);
    mode.enter(1);

    window.dispatchEvent(new Event("keydown"));
    expect(handler).not.toHaveBeenCalled();

    releaseBufferedKeyEvents();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("releases the buffer after a timeout even if settings never load", () => {
    vi.useFakeTimers();
    try {
      initModeHub(makeTestEnv());
      beginBufferingKeyEvents();
      const mode = new ModeHandle("Normal");
      const handler = vi.fn();
      mode.addEventListener("keydown", handler);
      mode.enter(1);

      window.dispatchEvent(new Event("keydown"));
      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5000);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches iframeBoot on the first keydown in an iframe", () => {
    const originalTop = window.top;
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    try {
      initModeHub(makeTestEnv());
      const bootSpy = vi.fn();
      document.addEventListener("surfingkeys:iframeBoot", bootSpy, { once: true });

      window.dispatchEvent(new Event("keydown"));

      expect(bootSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "top", { value: originalTop, configurable: true });
    }
  });

  it("prevents default and stops propagation for buffered keys", () => {
    initModeHub(makeTestEnv());
    beginBufferingKeyEvents();

    const event = new Event("keydown", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    const stopImmediatePropagation = vi.spyOn(event, "stopImmediatePropagation");

    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalled();
  });

  it("buffers multiple iframe keys pressed before boot and delivers them in order", () => {
    const originalTop = window.top;
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    try {
      initModeHub(makeTestEnv());
      beginBufferingKeyEvents();
      const mode = new ModeHandle("Normal");
      const seen: Event[] = [];
      mode.addEventListener("keydown", (e) => {
        seen.push(e);
      });

      // Keys arrive while the iframe is still booting (modeStack empty).
      const first = new Event("keydown");
      const second = new Event("keydown");
      window.dispatchEvent(first);
      window.dispatchEvent(second);
      expect(seen).toHaveLength(0);

      mode.enter(1);
      document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsApplied"));

      expect(seen).toEqual([first, second]);
    } finally {
      Object.defineProperty(window, "top", { value: originalTop, configurable: true });
    }
  });

  it("buffers and prevents default on the boot key when the boot handler starts buffering", () => {
    const originalTop = window.top;
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    try {
      // Mirror the content script: start buffering synchronously when the iframe boots.
      document.addEventListener(
        "surfingkeys:iframeBoot",
        () => {
          beginBufferingKeyEvents();
        },
        { once: true },
      );
      initModeHub(makeTestEnv());
      const mode = new ModeHandle("Normal");
      const handler = vi.fn();
      mode.addEventListener("keydown", handler);

      const event = new Event("keydown", { cancelable: true });
      const preventDefault = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);
      expect(handler).not.toHaveBeenCalled();
      expect(preventDefault).toHaveBeenCalled();

      mode.enter(1);
      document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsApplied"));
      expect(handler).toHaveBeenCalledTimes(1);

      mode.exit();
    } finally {
      Object.defineProperty(window, "top", { value: originalTop, configurable: true });
    }
  });

  it("replays a buffered iframe boot key when released directly (settings fetch failed)", () => {
    const originalTop = window.top;
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    try {
      document.addEventListener(
        "surfingkeys:iframeBoot",
        () => {
          beginBufferingKeyEvents();
        },
        { once: true },
      );
      initModeHub(makeTestEnv());
      const mode = new ModeHandle("Normal");
      const handler = vi.fn();
      mode.addEventListener("keydown", handler);

      window.dispatchEvent(new Event("keydown"));
      expect(handler).not.toHaveBeenCalled();

      mode.enter(1);
      releaseBufferedKeyEvents();
      expect(handler).toHaveBeenCalledTimes(1);

      mode.exit();
    } finally {
      Object.defineProperty(window, "top", { value: originalTop, configurable: true });
    }
  });

  it("replays an arbitrary keydown/keyup sequence to handlers in dispatch order", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("keydown", "keyup"), { maxLength: 30 }), (names) => {
        initModeHub(makeTestEnv());
        beginBufferingKeyEvents();
        const mode = new ModeHandle("Normal");
        const seen: string[] = [];
        mode.addEventListener("keydown", () => {
          seen.push("keydown");
        });
        mode.addEventListener("keyup", () => {
          seen.push("keyup");
        });
        mode.enter(1);

        for (const name of names) {
          window.dispatchEvent(new Event(name));
        }
        expect(seen).toHaveLength(0);

        releaseBufferedKeyEvents();
        expect(seen).toStrictEqual(names);

        mode.exit();
      }),
    );
  });
});
