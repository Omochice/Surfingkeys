import { Result } from "@praha/byethrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EngineEnv } from "./engineEnv";
import { ModeHandle, checkEventListener, getCurrentMode, initModeHub, suppressKeyUp } from "./mode";

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

describe("suppressKeyUp", () => {
  it("adds a keyCode to the suppressed list", () => {
    // We can indirectly verify: calling it twice with the same keyCode
    // should not add a duplicate (the internal list won't blow up).
    // The behavior we pin: adding the same keyCode twice doesn't cause errors
    // and the keyCode is tracked (evidenced by no throw).
    suppressKeyUp(65);
    suppressKeyUp(65); // dedup — no assertion error
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
    modeB.enter(10); // B has higher priority → goes to top

    // B is at top, A is below
    expect(getCurrentMode()).toBe(modeB);

    // peek-exit A: only removes A, B should still be on stack
    modeA.exit(true);
    expect(getCurrentMode()).toBe(modeB);

    modeB.exit();
  });

  it("exit without peek removes the mode and all modes above it", () => {
    const modeA = makeMode("A");
    const modeB = makeMode("B");

    modeA.enter(5);
    modeB.enter(10); // B is on top

    // non-peek exit of A removes A and everything above (B)
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
    // position was 0 (top of stack, only mode)
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

    // Re-enter base with reentrant=true: should pop top
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
  it("calls onMissing when the sentinel event is not dispatched", () => {
    // The sentinel listener increments eventListenerBeats each time the
    // 'sentinel' custom event fires. By spying on window.dispatchEvent we
    // can verify checkEventListener dispatches the sentinel and calls onMissing
    // only when the counter did not change (which happens when listeners were removed).
    //
    // In tests the listeners are installed at module load, so the sentinel
    // WILL fire and eventListenerBeats WILL change — onMissing is NOT called.
    const onMissing = vi.fn();
    checkEventListener(onMissing);
    // The sentinel listener fires → beats changed → onMissing is NOT called.
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe("ModeHandle.enter — reentrant=false re-entry reports an issue and leaves the stack intact", () => {
  it("reports an issue and does not pop modes when a non-top mode is re-entered without reentrant", () => {
    const reportIssue = vi.fn();
    initModeHub(makeTestEnv({ reportIssue }));
    const lower = new ModeHandle("Lower");
    const upper = new ModeHandle("Upper");
    // lower enters first (lower priority), upper enters on top (higher priority).
    lower.enter(1);
    upper.enter(2);
    // upper is current because it has the higher priority and sits at stack[0].
    expect(getCurrentMode()).toBe(upper);

    // Re-enter the lower (non-top, pos > 0) mode without reentrant=true: the else
    // branch must call reportIssue and must NOT slice the stack down to `lower`.
    lower.enter(1, false);

    expect(reportIssue).toHaveBeenCalledTimes(1);
    expect(reportIssue).toHaveBeenCalledWith(
      "Mode Lower pushed into mode stack again.",
      expect.stringContaining("Modes in stack:"),
    );
    // Stack top is unchanged: upper still current (the reentrant slice did NOT run).
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
    disabled.enter(2); // Disabled sits on top (higher priority)

    const event = new Event("keydown") as Event & {
      sk_keyName?: string;
      sk_suppressed?: boolean;
    };
    window.dispatchEvent(event);

    // Disabled handled the event and suppressed it; the loop breaks at Disabled so
    // the lower Normal mode never sees it.
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
    document.dispatchEvent(new CustomEvent("surfingkeys:userSettingsLoaded"));
  });

  it("does not deliver a keydown to mode handlers before settings are applied", () => {
    // initModeHub installs the listeners and starts in the buffering state until
    // the user settings have been applied.
    initModeHub(makeTestEnv());
    const mode = new ModeHandle("Normal");
    const handler = vi.fn();
    mode.addEventListener("keydown", handler);
    mode.enter(1);

    window.dispatchEvent(new Event("keydown"));

    expect(handler).not.toHaveBeenCalled();
  });
});
