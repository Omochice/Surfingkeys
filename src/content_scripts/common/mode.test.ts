import { beforeEach, describe, expect, it } from "vitest";

import KeyboardUtils from "./keyboardUtils";
import Mode from "./mode";
import Trie from "./trie";

type FakeKeyEvent = {
  sk_keyName: string;
  isTrusted: boolean;
  sk_stopPropagation?: boolean;
  sk_suppressed?: boolean;
};

function makeMode() {
  const mode = new Mode("Test");
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
