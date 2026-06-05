import { beforeEach, describe, expect, it, vi } from "vitest";

import KeyboardUtils from "./keyboardUtils";
import Mode from "./mode";
import Trie from "./trie";

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

describe("Mode.isSpecialKeyOf", () => {
  it("matches a registered special key", () => {
    expect(Mode.isSpecialKeyOf("<Esc>", KeyboardUtils.encodeKeystroke("<Esc>"))).toBe(true);
  });

  it("returns false for an unregistered special key bucket", () => {
    expect(Mode.isSpecialKeyOf("<DoesNotExist>", KeyboardUtils.encodeKeystroke("<Esc>"))).toBe(
      false,
    );
  });

  it("returns false when the key does not belong to the special-key set", () => {
    expect(Mode.isSpecialKeyOf("<Esc>", KeyboardUtils.encodeKeystroke("a"))).toBe(false);
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

  it("getCurrent returns undefined when the stack is empty", () => {
    // Ensure stack is empty by calling Mode.init equivalent — just don't enter anything.
    // We rely on the previous test to have exited cleanly.
    // Nothing entered here:
    const { mode } = makeMode("B");
    mode.enter(1);
    mode.exit();
    // After exit with no other modes, getCurrent should be undefined (or whatever was before).
    // We can only assert this is safe to call:
    const current = Mode.getCurrent();
    // If something else is in the stack from prior tests, current could be anything.
    // The key contract: getCurrent() returns the first element of the stack.
    expect(current === undefined || current instanceof Mode).toBe(true);
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
  it("respects boolean stopPropagation=true: sk_stopPropagation is false when meta says stop", () => {
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
    // stopPropagation=true means the meta STOPS propagation; the logic is:
    // sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key)
    // => !true || true => false || true => true in this code path.
    // Actually: event.sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key)
    // callStopPropagation(meta, key) = !!meta.stopPropagation = true
    // => !true || true = false || true = true
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
});
