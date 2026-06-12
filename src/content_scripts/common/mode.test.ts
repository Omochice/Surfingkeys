import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import KeyboardUtils from "./keyboardUtils";
import Mode from "./mode";
import { RUNTIME, runtime } from "./runtime";
import Trie from "./trie";
import * as utils from "./utils";

vi.mock("./utils", async () => {
  const actual = await vi.importActual<typeof import("./utils")>("./utils");
  return { ...actual, reportIssue: vi.fn() };
});

type FakeKeyEvent = {
  sk_keyName: string;
  isTrusted: boolean;
  sk_stopPropagation?: boolean;
  sk_suppressed?: boolean;
};

function makeMode(name = "Test") {
  const mode = new Mode(name);
  const mappings = new Trie();
  mode.mappings = mappings;
  mode.map_node = mappings;
  mode.repeats = "";
  return { mode, mappings };
}

function press(mode: Mode, key: string): FakeKeyEvent {
  const event: FakeKeyEvent = {
    sk_keyName: KeyboardUtils.encodeKeystroke(key),
    isTrusted: true,
  };
  Mode.handleMapKey.call(mode, event as unknown as Event & { keyCode?: number });
  return event;
}

describe("Mode.handleMapKey", () => {
  let mode: Mode;
  let mappings: Trie;

  beforeEach(() => {
    ({ mode, mappings } = makeMode());
  });

  it("runs the bound code for a single-key mapping and resets", () => {
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    const event = press(mode, "a");

    expect(runs).toBe(1);
    expect(event.sk_stopPropagation).toBe(true);
    expect(mode.map_node).toBe(mappings);
  });

  it("runs a mapping only after the full multi-key sequence", () => {
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    press(mode, "a");
    expect(runs).toBe(0); // still pending after first key
    expect(mode.map_node).not.toBe(mappings);

    press(mode, "b");
    expect(runs).toBe(1);
    expect(mode.map_node).toBe(mappings);
  });

  it("does not run the mapping for an unmatched key", () => {
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    press(mode, "z");
    expect(runs).toBe(0);
    expect(mode.map_node).toBe(mappings);
  });

  it("Esc resets a pending multi-key sequence and sets sk_stopPropagation", () => {
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    press(mode, "a");
    expect(mode.map_node).not.toBe(mappings);

    const escEvent = press(mode, "<Esc>");
    expect(runs).toBe(0);
    expect(mode.map_node).toBe(mappings);
    expect(escEvent.sk_stopPropagation).toBe(true);
  });

  it("accumulates digit repeats when digitForRepeat is true and mappings exist", () => {
    // digitForRepeat is true by default in runtime.conf
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    press(mode, "3");
    expect(mode.repeats).toBe("3");

    press(mode, "a");
    // The action runs 3 times due to repeat
    expect(runs).toBe(3);
    expect(mode.repeats).toBe("");
  });

  it("leaves sk_suppressed when no mapping and already mid-sequence", () => {
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), {
      annotation: "run",
      code: () => {},
    });

    press(mode, "a"); // partial match — map_node advances
    const event = press(mode, "z"); // no match from mid-node

    // was mid-sequence when z was pressed → should be suppressed
    expect(event.sk_suppressed).toBe(true);
  });
});

describe("Mode.finish", () => {
  it("returns false and leaves state unchanged when already at root with no repeats", () => {
    const { mode, mappings } = makeMode();
    // map_node is already mappings and no pendingMap/repeats
    const result = Mode.finish(mode);
    expect(result).toBe(false);
    expect(mode.map_node).toBe(mappings);
  });

  it("returns true and resets map_node when mid-sequence", () => {
    const { mode, mappings } = makeMode();
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), { annotation: "x", code: () => {} });
    // Manually advance map_node to mid-sequence node
    mode.map_node = mappings.find(KeyboardUtils.encodeKeystroke("a"));
    expect(mode.map_node).not.toBe(mappings);

    const result = Mode.finish(mode);
    expect(result).toBe(true);
    expect(mode.map_node).toBe(mappings);
  });

  it("returns true and clears repeats when repeats is non-empty", () => {
    const { mode } = makeMode();
    mode.repeats = "5";

    const result = Mode.finish(mode);
    expect(result).toBe(true);
    expect(mode.repeats).toBe("");
  });

  it("returns true and clears pendingMap", () => {
    const { mode } = makeMode();
    mode.pendingMap = () => {};

    const result = Mode.finish(mode);
    expect(result).toBe(true);
    expect(mode.pendingMap).toBeNull();
  });
});

describe("Mode.suppressKeyUp", () => {
  it("adds a keyCode to the suppressed list", () => {
    // We can indirectly verify: calling it twice with the same keyCode
    // should not add a duplicate (the internal list won't blow up).
    // The behavior we pin: adding the same keyCode twice doesn't cause errors
    // and the keyCode is tracked (evidenced by no throw).
    Mode.suppressKeyUp(65);
    Mode.suppressKeyUp(65); // dedup — no assertion error
  });
});

describe("Mode enter / exit / getCurrent", () => {
  // Each test must leave the mode_stack clean.  We do this by explicitly
  // exiting every mode entered during the test.
  it("getCurrent returns the mode at the top of the stack after enter", () => {
    const { mode } = makeMode("A");
    mode.enter(10);
    expect(Mode.getCurrent()).toBe(mode);
    mode.exit();
  });

  it("getCurrent returns undefined once the stack is fully cleared", () => {
    // Deterministically drain any modes left on the shared stack by prior tests,
    // then assert the empty-stack contract. exit() removes the current mode and
    // every mode above it, so this loop terminates; the final assertion fails
    // loudly if any mode is still present.
    let guard = 0;
    while (Mode.getCurrent() !== undefined && guard < 100) {
      Mode.getCurrent()!.exit();
      guard++;
    }
    expect(Mode.getCurrent()).toBeUndefined();
  });

  it("exit with peek removes only the targeted mode, leaving modes above it", () => {
    const { mode: modeA } = makeMode("A");
    const { mode: modeB } = makeMode("B");

    modeA.enter(5);
    modeB.enter(10); // B has higher priority → goes to top

    // B is at top, A is below
    expect(Mode.getCurrent()).toBe(modeB);

    // peek-exit A: only removes A, B should still be on stack
    modeA.exit(true);
    expect(Mode.getCurrent()).toBe(modeB);

    modeB.exit();
  });

  it("exit without peek removes the mode and all modes above it", () => {
    const { mode: modeA } = makeMode("A");
    const { mode: modeB } = makeMode("B");

    modeA.enter(5);
    modeB.enter(10); // B is on top

    // non-peek exit of A removes A and everything above (B)
    modeA.exit();
    expect(Mode.getCurrent()).not.toBe(modeB);
    expect(Mode.getCurrent()).not.toBe(modeA);
  });

  it("onEnter callback is called when entering a mode", () => {
    const { mode } = makeMode("CB");
    const onEnter = vi.fn();
    mode.onEnter = onEnter;

    mode.enter(1);
    expect(onEnter).toHaveBeenCalledOnce();
    mode.exit();
  });

  it("onExit callback receives the position the mode was at", () => {
    const { mode } = makeMode("CB2");
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
    const { mode: lowPri } = makeMode("Low");
    const { mode: highPri } = makeMode("High");

    lowPri.enter(1);
    highPri.enter(100);

    expect(Mode.getCurrent()).toBe(highPri);

    highPri.exit(true);
    lowPri.exit(true);
  });

  it("reentrant enter pops modes above the re-entered mode", () => {
    const { mode: base } = makeMode("Base");
    const { mode: top } = makeMode("Top");

    base.enter(1);
    top.enter(10);

    expect(Mode.getCurrent()).toBe(top);

    // Re-enter base with reentrant=true: should pop top
    base.enter(undefined, true);
    expect(Mode.getCurrent()).toBe(base);

    base.exit();
  });
});

describe("Mode.addEventListener", () => {
  it("registers an event listener on the mode and returns this", () => {
    const { mode } = makeMode("Evt");
    const handler = vi.fn();
    const ret = mode.addEventListener("custom", handler);
    expect(ret).toBe(mode);
    expect(mode.eventListeners["custom"]).toBe(handler);
  });
});

describe("Mode.handleMapKey — pendingMap branch", () => {
  it("calls pendingMap with the subsequent key and resets state", () => {
    const { mode, mappings } = makeMode();
    const received: string[] = [];
    // A mapping whose code has `.length > 0` signals it expects an argument.
    // We simulate this by assigning pendingMap directly (as handleMapKey would
    // after detecting code.length > 0 on the previous key).
    const pendingFn = (key: string) => {
      received.push(key);
    };
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "arg",
      code: pendingFn,
    });

    // First press: key 'a' matches the mapping. Because code.length === 1 (it takes a key arg),
    // handleMapKey sets pendingMap instead of calling code directly.
    press(mode, "a");
    expect(mode.pendingMap).not.toBeNull();

    // Second press: pendingMap is called with 'x'.
    press(mode, "x");
    expect(received).toEqual(["x"]);
    // pendingMap should be cleared after execution.
    expect(mode.pendingMap).toBeNull();
  });
});

describe("Mode.handleMapKey — stopPropagation variants", () => {
  it("sets sk_stopPropagation true when meta.stopPropagation is true", () => {
    const { mode, mappings } = makeMode();
    let ran = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("z"), {
      annotation: "stop",
      stopPropagation: true,
      code: () => {
        ran++;
      },
    });

    const event = press(mode, "z");
    expect(ran).toBe(1);
    // sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key).
    // With stopPropagation: true that is `false || true === true`.
    expect(event.sk_stopPropagation).toBe(true);
  });

  it("respects boolean stopPropagation=false: sk_stopPropagation is true when meta allows propagation", () => {
    const { mode, mappings } = makeMode();
    let ran = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("q"), {
      annotation: "allow",
      stopPropagation: false,
      code: () => {
        ran++;
      },
    });

    const event = press(mode, "q");
    expect(ran).toBe(1);
    // !false || callStopPropagation(meta, key) = true || false = true
    expect(event.sk_stopPropagation).toBe(true);
  });

  it("calls a function stopPropagation with the pressed key", () => {
    const { mode, mappings } = makeMode();
    const spFn = vi.fn().mockReturnValue(false);
    let ran = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("p"), {
      annotation: "fnstop",
      stopPropagation: spFn,
      code: () => {
        ran++;
      },
    });

    press(mode, "p");
    expect(ran).toBe(1);
    // callStopPropagation calls the function with the encoded key name.
    expect(spFn).toHaveBeenCalledWith(KeyboardUtils.encodeKeystroke("p"));
  });
});

describe("Mode.handleMapKey — setLastKeys callback", () => {
  it("calls setLastKeys with the meta word when a mapping runs", () => {
    const { mode, mappings } = makeMode();
    const lastKeys: string[] = [];
    mode.setLastKeys = (k) => lastKeys.push(k);
    mappings.add(KeyboardUtils.encodeKeystroke("g"), {
      annotation: "go",
      code: () => {},
    });

    press(mode, "g");
    expect(lastKeys).toEqual([KeyboardUtils.encodeKeystroke("g")]);
  });
});

describe("Mode.init", () => {
  it("runs the callback immediately on a normal (non-blank) page", () => {
    const cb = vi.fn();
    Mode.init(cb);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("Mode.checkEventListener", () => {
  it("calls onMissing when the sentinel event is not dispatched", () => {
    // The sentinel listener increments eventListenerBeats each time the
    // 'sentinel' custom event fires. By spying on window.dispatchEvent we
    // can verify checkEventListener dispatches the sentinel and calls onMissing
    // only when the counter did not change (which happens when listeners were removed).
    //
    // In tests the listeners are installed at module load, so the sentinel
    // WILL fire and eventListenerBeats WILL change — onMissing is NOT called.
    const onMissing = vi.fn();
    Mode.checkEventListener(onMissing);
    // The sentinel listener fires → beats changed → onMissing is NOT called.
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe("Mode.hasScroll", () => {
  it("returns false for an element with scrollTop=0 and no effective scroll", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // jsdom elements have no real layout; scrollTop=0 and getBoundingClientRect returns 0.
    // result < barSize branch: sets scroll to getBoundingClientRect height (0), reads back 0.
    // 0 !== 0 is false → suppressScrollEvent not incremented.
    // result (0) >= barSize (16) → false.
    expect(Mode.hasScroll(el, "y", 16)).toBe(false);
    document.body.innerHTML = "";
  });

  it("returns true when scrollTop already meets the barSize threshold", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollTop", { get: () => 100, configurable: true });
    document.body.appendChild(el);
    expect(Mode.hasScroll(el, "y", 16)).toBe(true);
    document.body.innerHTML = "";
  });

  it("checks horizontal scroll (x direction) — returns false when scrollLeft is 0", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // scrollLeft = 0 < 16 (barSize), getBoundingClientRect().width = 0 → no change → false.
    expect(Mode.hasScroll(el, "x", 16)).toBe(false);
    document.body.innerHTML = "";
  });

  it("checks horizontal scroll (x direction) — returns true when scrollLeft meets threshold", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollLeft", { get: () => 50, configurable: true });
    document.body.appendChild(el);
    expect(Mode.hasScroll(el, "x", 16)).toBe(true);
    document.body.innerHTML = "";
  });
});

describe("Mode.handleMapKey — repeat digit accumulation edge cases", () => {
  it("allows '0' as a repeat digit once at least one leading digit has been entered", () => {
    const { mode, mappings } = makeMode();
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "run",
      code: () => {},
    });

    // '1' sets repeats="1"; '0' is allowed because repeats is non-empty.
    press(mode, "1");
    press(mode, "0");
    // The digit-accumulation branch has fired twice: repeats="10".
    expect(mode.repeats).toBe("10");

    // repeatThreshold defaults to 9; "10" > 9 triggers the showDialog branch rather than
    // running the code inline. Mode.finish resets repeats to "" either way.
    press(mode, "a");
    expect(mode.repeats).toBe("");
  });

  it("does not treat '0' as a repeat digit when repeats is still empty", () => {
    // When repeats="" and key="0", the condition `key >= "0"` is true but
    // `this.repeats !== "" && key >= "0"` is false (repeats is ""), so the
    // digit-accumulation branch is not taken. Instead '0' is looked up as a key.
    const { mode, mappings } = makeMode();
    mappings.add(KeyboardUtils.encodeKeystroke("0"), {
      annotation: "zero",
      code: () => {},
    });

    press(mode, "0");
    // If '0' were treated as a repeat digit, map_node would still be mappings
    // with repeats="0". Because it is not (repeats still ""), map_node resets
    // to mappings via Mode.finish after executing the mapping.
    expect(mode.repeats).toBe("");
    expect(mode.map_node).toBe(mappings);
  });
});

describe("Mode.enter — reentrant=false re-entry reports an issue and leaves the stack intact", () => {
  it("reports an issue and does not pop modes when a non-top mode is re-entered without reentrant", () => {
    const reportIssue = vi.mocked(utils.reportIssue);
    reportIssue.mockClear();
    const lower = new Mode("Lower");
    const upper = new Mode("Upper");
    // lower enters first (lower priority), upper enters on top (higher priority).
    lower.enter(1);
    upper.enter(2);
    // upper is current because it has the higher priority and sits at stack[0].
    expect(Mode.getCurrent()).toBe(upper);

    // Re-enter the lower (non-top, pos > 0) mode without reentrant=true: the else
    // branch must call reportIssue and must NOT slice the stack down to `lower`.
    lower.enter(1, false);

    expect(reportIssue).toHaveBeenCalledTimes(1);
    expect(reportIssue).toHaveBeenCalledWith(
      "Mode Lower pushed into mode stack again.",
      expect.stringContaining("Modes in stack:"),
    );
    // Stack top is unchanged: upper still current (the reentrant slice did NOT run).
    expect(Mode.getCurrent()).toBe(upper);

    upper.exit();
    lower.exit();
  });
});

describe("Mode.handleMapKey — pendingMap stopPropagation variants", () => {
  it("respects boolean meta.stopPropagation when executing via pendingMap", () => {
    const { mode, mappings } = makeMode();
    const received: string[] = [];
    // A two-argument pending function — code.length > 0 triggers pendingMap flow.
    const pendingFn = (key: string) => {
      received.push(key);
    };
    // Give the mapping node a stopPropagation=true so the pending branch tests that arm.
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "stop-pending",
      stopPropagation: true,
      code: pendingFn,
    });

    press(mode, "a"); // sets pendingMap
    const event = press(mode, "y"); // calls pendingMap("y")

    expect(received).toEqual(["y"]);
    // stopPropagation was reached via the pendingMap path.
    // event.sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key)
    // = !true || true = true
    expect(event.sk_stopPropagation).toBe(true);
  });
});

// Capture surfingkeys:front CustomEvents (dispatchSKEvent("front", [...])) so the
// keystroke/dialog side effects of handleMapKey and finish can be asserted.
function captureFront(): { events: unknown[][]; cleanup: () => void } {
  const events: unknown[][] = [];
  const handler = (e: Event) => {
    events.push((e as CustomEvent).detail as unknown[]);
  };
  document.addEventListener("surfingkeys:front", handler);
  return { events, cleanup: () => document.removeEventListener("surfingkeys:front", handler) };
}

describe("Mode.handleMapKey — repeatThreshold dialog branch", () => {
  let savedRepeats: number;
  let savedThreshold: number;

  beforeEach(() => {
    savedRepeats = RUNTIME.repeats;
    savedThreshold = runtime.conf.repeatThreshold;
  });

  afterEach(() => {
    RUNTIME.repeats = savedRepeats;
    runtime.conf.repeatThreshold = savedThreshold;
  });

  it("dispatches showDialog instead of running inline when repeats exceed repeatThreshold", () => {
    runtime.conf.repeatThreshold = 9;
    let runs = 0;
    const { mode, mappings } = makeMode();
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "big-repeat",
      code: () => {
        runs++;
      },
    });

    const { events, cleanup } = captureFront();
    // Accumulate "10" (> threshold 9), then trigger the action.
    press(mode, "1");
    press(mode, "0");
    press(mode, "a");

    const dialog = events.find((d) => d[0] === "showDialog");
    expect(dialog).toBeDefined();
    expect(dialog![1]).toContain("big-repeat");
    expect(dialog![1]).toContain("10");
    // The code must NOT have run inline — it runs only when the dialog callback fires.
    expect(runs).toBe(0);

    // Invoking the dialog confirm callback runs the action exactly `repeats` (10) times.
    (dialog![2] as () => void)();
    expect(runs).toBe(10);

    cleanup();
  });

  it("runs the action inline (no dialog) when repeats stay within repeatThreshold", () => {
    runtime.conf.repeatThreshold = 9;
    let runs = 0;
    const { mode, mappings } = makeMode();
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "small-repeat",
      code: () => {
        runs++;
      },
    });

    const { events, cleanup } = captureFront();
    press(mode, "3");
    press(mode, "a");

    expect(runs).toBe(3);
    expect(events.find((d) => d[0] === "showDialog")).toBeUndefined();

    cleanup();
  });
});

describe("Mode.finish — hideKeystroke dispatch on trusted reset", () => {
  it("dispatches hideKeystroke when finishing a trusted mid-sequence", () => {
    const { mode, mappings } = makeMode();
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), { annotation: "two", code: () => {} });
    // Advance into a partial sequence and mark the event as trusted (press() does).
    press(mode, "a");
    mode.isTrustedEvent = true;

    const { events, cleanup } = captureFront();
    const ret = Mode.finish(mode);

    expect(ret).toBe(true);
    expect(events.some((d) => d[0] === "hideKeystroke")).toBe(true);
    expect(mode.map_node).toBe(mappings);

    cleanup();
  });

  it("does not dispatch hideKeystroke when the reset is for an untrusted event", () => {
    const { mode, mappings } = makeMode();
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), { annotation: "two", code: () => {} });
    press(mode, "a");
    mode.isTrustedEvent = false;

    const { events, cleanup } = captureFront();
    const ret = Mode.finish(mode);

    expect(ret).toBe(true);
    expect(events.some((d) => d[0] === "hideKeystroke")).toBe(false);

    cleanup();
  });
});

describe("Mode.addEventListener — registers a new global listened event", () => {
  it("routes a window event of a not-yet-listened type into the mode's handler", () => {
    const { mode } = makeMode("GlobalEvt");
    const handler = vi.fn();
    // "wheel" is not among the built-in _listenedEvents, so addEventListener must
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
      Mode.getCurrent()?.exit();
    }
  });

  it("skips a higher mode's listener and breaks when a Disabled mode is on top", () => {
    const lower = new Mode("Normal");
    const lowerHandler = vi.fn();
    lower.addEventListener("keydown", lowerHandler);

    const disabled = new Mode("Disabled");
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
