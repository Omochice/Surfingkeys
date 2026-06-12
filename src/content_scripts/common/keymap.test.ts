import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import KeyboardUtils from "./keyboardUtils";
import { type KeyEventLike, type Keymap, type KeymapOptions, createKeymap } from "./keymap";
import { RUNTIME, runtime } from "./runtime";
import Trie from "./trie";

function makeKeymap(opts?: KeymapOptions) {
  const mappings = new Trie();
  const keymap = createKeymap(() => mappings, { enableRepeats: true, ...opts });
  return { keymap, mappings };
}

function press(keymap: Keymap, key: string, isTrusted = true): KeyEventLike {
  const event: KeyEventLike = {
    isTrusted,
    sk_keyName: KeyboardUtils.encodeKeystroke(key),
  };
  keymap.handleKey(event);
  return event;
}

// Capture surfingkeys:front CustomEvents (dispatchSKEvent("front", [...])) so the
// keystroke/dialog side effects of handleKey and finish can be asserted.
function captureFront(): { events: unknown[][]; cleanup: () => void } {
  const events: unknown[][] = [];
  const handler = (e: Event) => {
    events.push((e as CustomEvent).detail as unknown[]);
  };
  document.addEventListener("surfingkeys:front", handler);
  return { events, cleanup: () => document.removeEventListener("surfingkeys:front", handler) };
}

describe("Keymap.handleKey", () => {
  let keymap: Keymap;
  let mappings: Trie;

  beforeEach(() => {
    ({ keymap, mappings } = makeKeymap());
  });

  it("runs the bound code for a single-key mapping and resets", () => {
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    const event = press(keymap, "a");

    expect(runs).toBe(1);
    expect(event.sk_stopPropagation).toBe(true);
    expect(keymap.getCurrentNode()).toBe(mappings);
  });

  it("runs a mapping only after the full multi-key sequence", () => {
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    press(keymap, "a");
    expect(runs).toBe(0); // still pending after first key
    expect(keymap.getCurrentNode()).not.toBe(mappings);

    press(keymap, "b");
    expect(runs).toBe(1);
    expect(keymap.getCurrentNode()).toBe(mappings);
  });

  it("does not run the mapping for an unmatched key", () => {
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    press(keymap, "z");
    expect(runs).toBe(0);
    expect(keymap.getCurrentNode()).toBe(mappings);
  });

  it("Esc resets a pending multi-key sequence and sets sk_stopPropagation", () => {
    let runs = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), {
      annotation: "run",
      code: () => {
        runs++;
      },
    });

    press(keymap, "a");
    expect(keymap.getCurrentNode()).not.toBe(mappings);

    const escEvent = press(keymap, "<Esc>");
    expect(runs).toBe(0);
    expect(keymap.getCurrentNode()).toBe(mappings);
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

    press(keymap, "3");
    expect(keymap.repeats).toBe("3");

    press(keymap, "a");
    // The action runs 3 times due to repeat
    expect(runs).toBe(3);
    expect(keymap.repeats).toBe("");
  });

  it("leaves sk_suppressed when no mapping and already mid-sequence", () => {
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), {
      annotation: "run",
      code: () => {},
    });

    press(keymap, "a"); // partial match — the current node advances
    const event = press(keymap, "z"); // no match from mid-node

    // was mid-sequence when z was pressed → should be suppressed
    expect(event.sk_suppressed).toBe(true);
  });

  it("dispatches showKeystroke carrying the keymap (with its mappings) mid-sequence", () => {
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), {
      annotation: "run",
      code: () => {},
    });

    const { events, cleanup } = captureFront();
    press(keymap, "a");

    // front.ts's showKeystroke receiver reads `.mappings` off the payload to build
    // the candidate hints; pin the structural contract of the untyped channel.
    const shown = events.find((d) => d[0] === "showKeystroke");
    expect(shown).toBeDefined();
    expect(shown![1]).toBe(KeyboardUtils.encodeKeystroke("a"));
    expect((shown![2] as { mappings: Trie }).mappings).toBe(mappings);

    cleanup();
  });
});

describe("Keymap without enableRepeats", () => {
  it("exposes repeats as undefined and never accumulates digits", () => {
    const mappings = new Trie();
    const keymap = createKeymap(() => mappings);
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "run",
      code: () => {},
    });

    press(keymap, "3");

    // The digit is looked up as an ordinary key (and misses) instead of counting.
    expect(keymap.repeats).toBeUndefined();
    expect(keymap.getCurrentNode()).toBe(mappings);
  });
});

describe("Keymap.finish", () => {
  it("returns false and leaves state unchanged when already at root with no repeats", () => {
    const { keymap, mappings } = makeKeymap();

    const result = keymap.finish();

    expect(result).toBe(false);
    expect(keymap.getCurrentNode()).toBe(mappings);
  });

  it("returns true and resets the current node when mid-sequence", () => {
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), { annotation: "x", code: () => {} });
    press(keymap, "a");
    expect(keymap.getCurrentNode()).not.toBe(mappings);

    const result = keymap.finish();

    expect(result).toBe(true);
    expect(keymap.getCurrentNode()).toBe(mappings);
  });

  it("returns true and clears repeats when repeats is non-empty", () => {
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("a"), { annotation: "x", code: () => {} });
    press(keymap, "5");
    expect(keymap.repeats).toBe("5");

    const result = keymap.finish();

    expect(result).toBe(true);
    expect(keymap.repeats).toBe("");
  });

  it("returns true and clears a pending argument mapping", () => {
    const { keymap, mappings } = makeKeymap();
    const received: string[] = [];
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "arg",
      code: (key: string) => {
        received.push(key);
      },
    });
    press(keymap, "a"); // code.length > 0 → waits for the argument key

    const result = keymap.finish();

    expect(result).toBe(true);
    // The pending mapping was discarded: the next key is an ordinary lookup.
    press(keymap, "x");
    expect(received).toEqual([]);
  });
});

describe("Keymap.reset", () => {
  it("re-roots the cursor without dispatching hideKeystroke", () => {
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), { annotation: "two", code: () => {} });
    press(keymap, "a"); // trusted mid-sequence

    const { events, cleanup } = captureFront();
    keymap.reset();

    expect(keymap.getCurrentNode()).toBe(mappings);
    // Unlike finish(), reset() is the silent re-root used when the root trie is
    // replaced wholesale (api.ts unmapAllExcept); it must not touch the front.
    expect(events).toEqual([]);

    cleanup();
  });

  it("discards a pending argument mapping belonging to the replaced root", () => {
    const { keymap, mappings } = makeKeymap();
    const received: string[] = [];
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "arg",
      code: (key: string) => {
        received.push(key);
      },
    });
    press(keymap, "a"); // waits for the argument key

    keymap.reset();

    // The pending code belongs to the (conceptually replaced) old root; the next
    // key must be an ordinary lookup, not an argument delivery.
    press(keymap, "x");
    expect(received).toEqual([]);
  });

  it("clears accumulated repeat digits", () => {
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("a"), { annotation: "x", code: () => {} });
    press(keymap, "5");
    expect(keymap.repeats).toBe("5");

    keymap.reset();

    expect(keymap.repeats).toBe("");
  });
});

describe("Keymap.handleKey — pendingMap branch", () => {
  it("calls the pending mapping with the subsequent key and resets state", () => {
    const { keymap, mappings } = makeKeymap();
    const received: string[] = [];
    // A mapping whose code has `.length > 0` signals it expects an argument.
    const pendingFn = (key: string) => {
      received.push(key);
    };
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "arg",
      code: pendingFn,
    });

    // First press: key 'a' matches the mapping. Because code.length === 1 (it takes a key
    // arg), handleKey waits for the next key instead of calling code directly.
    const first = press(keymap, "a");
    expect(first.sk_stopPropagation).toBe(true);

    // Second press: the pending mapping is called with 'x'.
    press(keymap, "x");
    expect(received).toEqual(["x"]);

    // The pending state was cleared: a further key is an ordinary (missing) lookup.
    press(keymap, "y");
    expect(received).toEqual(["x"]);
  });

  it("invokes the pending mapping with thisArg as `this`", () => {
    const mappings = new Trie();
    const thisArg = { marker: "controller" };
    const keymap = createKeymap(() => mappings, { thisArg });
    let captured: unknown;
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "arg",
      code: function (this: unknown, _key: string) {
        captured = this;
      },
    });

    press(keymap, "a");
    press(keymap, "x");

    expect(captured).toBe(thisArg);
  });
});

describe("Keymap.handleKey — stopPropagation variants", () => {
  it("sets sk_stopPropagation true when meta.stopPropagation is true", () => {
    const { keymap, mappings } = makeKeymap();
    let ran = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("z"), {
      annotation: "stop",
      stopPropagation: true,
      code: () => {
        ran++;
      },
    });

    const event = press(keymap, "z");
    expect(ran).toBe(1);
    // sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key).
    // With stopPropagation: true that is `false || true === true`.
    expect(event.sk_stopPropagation).toBe(true);
  });

  it("respects boolean stopPropagation=false: sk_stopPropagation is true when meta allows propagation", () => {
    const { keymap, mappings } = makeKeymap();
    let ran = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("q"), {
      annotation: "allow",
      stopPropagation: false,
      code: () => {
        ran++;
      },
    });

    const event = press(keymap, "q");
    expect(ran).toBe(1);
    // !false || callStopPropagation(meta, key) = true || false = true
    expect(event.sk_stopPropagation).toBe(true);
  });

  it("calls a function stopPropagation with the pressed key", () => {
    const { keymap, mappings } = makeKeymap();
    const spFn = vi.fn().mockReturnValue(false);
    let ran = 0;
    mappings.add(KeyboardUtils.encodeKeystroke("p"), {
      annotation: "fnstop",
      stopPropagation: spFn,
      code: () => {
        ran++;
      },
    });

    press(keymap, "p");
    expect(ran).toBe(1);
    // callStopPropagation calls the function with the encoded key name.
    expect(spFn).toHaveBeenCalledWith(KeyboardUtils.encodeKeystroke("p"));
  });

  it("respects boolean meta.stopPropagation when executing a pending mapping", () => {
    const { keymap, mappings } = makeKeymap();
    const received: string[] = [];
    const pendingFn = (key: string) => {
      received.push(key);
    };
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "stop-pending",
      stopPropagation: true,
      code: pendingFn,
    });

    press(keymap, "a"); // waits for the argument key
    const event = press(keymap, "y"); // delivers "y"

    expect(received).toEqual(["y"]);
    // event.sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key)
    // = !true || true = true
    expect(event.sk_stopPropagation).toBe(true);
  });
});

describe("Keymap.handleKey — onKeysExecuted callback", () => {
  it("reports the executed word together with its meta when a mapping runs", () => {
    const executed: { keys: string; repeatIgnore: boolean | undefined }[] = [];
    const { keymap, mappings } = makeKeymap({
      onKeysExecuted: (keys, meta) => {
        executed.push({ keys, repeatIgnore: meta.repeatIgnore });
      },
    });
    mappings.add(KeyboardUtils.encodeKeystroke("g"), {
      annotation: "go",
      repeatIgnore: true,
      code: () => {},
    });

    press(keymap, "g");

    expect(executed).toEqual([{ keys: KeyboardUtils.encodeKeystroke("g"), repeatIgnore: true }]);
  });

  it("reports the word plus the argument key for a pending mapping", () => {
    const executed: string[] = [];
    const { keymap, mappings } = makeKeymap({
      onKeysExecuted: (keys) => {
        executed.push(keys);
      },
    });
    mappings.add(KeyboardUtils.encodeKeystroke("m"), {
      annotation: "mark",
      code: (_key: string) => {},
    });

    press(keymap, "m");
    press(keymap, "x");

    expect(executed).toEqual([KeyboardUtils.encodeKeystroke("m") + "x"]);
  });
});

describe("Keymap.handleKey — repeat digit accumulation edge cases", () => {
  it("allows '0' as a repeat digit once at least one leading digit has been entered", () => {
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "run",
      code: () => {},
    });

    // '1' sets repeats="1"; '0' is allowed because repeats is non-empty.
    press(keymap, "1");
    press(keymap, "0");
    // The digit-accumulation branch has fired twice: repeats="10".
    expect(keymap.repeats).toBe("10");

    // repeatThreshold defaults to 9; "10" > 9 triggers the showDialog branch rather than
    // running the code inline. finish resets repeats to "" either way.
    press(keymap, "a");
    expect(keymap.repeats).toBe("");
  });

  it("does not treat '0' as a repeat digit when repeats is still empty", () => {
    // When repeats="" and key="0", the condition `key >= "0"` is true but
    // `repeats !== "" && key >= "0"` is false (repeats is ""), so the
    // digit-accumulation branch is not taken. Instead '0' is looked up as a key.
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("0"), {
      annotation: "zero",
      code: () => {},
    });

    press(keymap, "0");
    // If '0' were treated as a repeat digit, the current node would still be the root
    // with repeats="0". Because it is not (repeats still ""), the node resets to the
    // root via finish after executing the mapping.
    expect(keymap.repeats).toBe("");
    expect(keymap.getCurrentNode()).toBe(mappings);
  });
});

describe("Keymap.handleKey — repeatThreshold dialog branch", () => {
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
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "big-repeat",
      code: () => {
        runs++;
      },
    });

    const { events, cleanup } = captureFront();
    // Accumulate "10" (> threshold 9), then trigger the action.
    press(keymap, "1");
    press(keymap, "0");
    press(keymap, "a");

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
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("a"), {
      annotation: "small-repeat",
      code: () => {
        runs++;
      },
    });

    const { events, cleanup } = captureFront();
    press(keymap, "3");
    press(keymap, "a");

    expect(runs).toBe(3);
    expect(events.find((d) => d[0] === "showDialog")).toBeUndefined();

    cleanup();
  });
});

describe("Keymap.finish — hideKeystroke dispatch on trusted reset", () => {
  it("dispatches hideKeystroke when finishing a trusted mid-sequence", () => {
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), { annotation: "two", code: () => {} });
    // Advance into a partial sequence with a trusted event (press() defaults to trusted).
    press(keymap, "a");

    const { events, cleanup } = captureFront();
    const ret = keymap.finish();

    expect(ret).toBe(true);
    expect(events.some((d) => d[0] === "hideKeystroke")).toBe(true);
    expect(keymap.getCurrentNode()).toBe(mappings);

    cleanup();
  });

  it("does not dispatch hideKeystroke when the reset is for an untrusted event", () => {
    const { keymap, mappings } = makeKeymap();
    mappings.add(KeyboardUtils.encodeKeystroke("ab"), { annotation: "two", code: () => {} });
    press(keymap, "a", false);

    const { events, cleanup } = captureFront();
    const ret = keymap.finish();

    expect(ret).toBe(true);
    expect(events.some((d) => d[0] === "hideKeystroke")).toBe(false);

    cleanup();
  });
});
