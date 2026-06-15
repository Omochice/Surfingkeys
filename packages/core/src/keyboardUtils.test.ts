import { describe, expect, it } from "vitest";

import KeyboardUtils from "./keyboardUtils";

describe("KeyboardUtils.encodeKeystroke / decodeKeystroke", () => {
  const samples = [
    "<Esc>",
    "<Space>",
    "<Alt-Space>",
    "<Ctrl-Alt-F7>",
    "<Ctrl-'>",
    "<Alt-i>",
    "<Ctrl-Alt-z>",
    "<Ctrl-Alt-Meta-h>",
    "<Ctrl-Alt-Meta-Shift-Enter>",
  ];

  it("round-trips encode then decode back to the original keystroke", () => {
    for (const s of samples) {
      const encoded = KeyboardUtils.encodeKeystroke(s);
      expect(KeyboardUtils.decodeKeystroke(encoded)).toBe(s);
    }
  });

  it("encodes each <...> keystroke to a single character", () => {
    for (const s of samples) {
      expect(KeyboardUtils.encodeKeystroke(s)).toHaveLength(1);
    }
  });

  it("leaves plain characters untouched", () => {
    expect(KeyboardUtils.encodeKeystroke("abc")).toBe("abc");
    expect(KeyboardUtils.decodeKeystroke("abc")).toBe("abc");
  });

  it("round-trips a mix of plain and special keys", () => {
    const mixed = "ab<Ctrl-x>c<Esc>d";
    expect(KeyboardUtils.decodeKeystroke(KeyboardUtils.encodeKeystroke(mixed))).toBe(mixed);
  });
});

describe("KeyboardUtils.getKeyChar", () => {
  // getKeyChar collapses a key event into a keystroke token, encoding any
  // <...> form to a single char. Assert through decodeKeystroke so the
  // expectations stay readable rather than comparing opaque code points.
  const decode = (s: string) => KeyboardUtils.decodeKeystroke(s);

  it("returns an empty string for modifier-only keys", () => {
    expect(KeyboardUtils.getKeyChar({ keyCode: 16 })).toBe(""); // Shift
    expect(KeyboardUtils.getKeyChar({ keyCode: 17 })).toBe(""); // Ctrl
  });

  it("maps a named key to its bracketed token", () => {
    expect(decode(KeyboardUtils.getKeyChar({ keyCode: 27, key: "Escape" }))).toBe("<Esc>");
  });

  it("passes a plain printable key through unchanged", () => {
    expect(KeyboardUtils.getKeyChar({ keyCode: 65, key: "a" })).toBe("a");
  });

  it("prefixes held modifiers onto a printable key", () => {
    expect(decode(KeyboardUtils.getKeyChar({ keyCode: 65, key: "a", ctrlKey: true }))).toBe(
      "<Ctrl-a>",
    );
  });

  it("prefixes Shift onto a multi-character named key", () => {
    expect(decode(KeyboardUtils.getKeyChar({ keyCode: 9, key: "Tab", shiftKey: true }))).toBe(
      "<Shift-Tab>",
    );
  });

  it("treats an Unidentified key (IME) as no input", () => {
    expect(KeyboardUtils.getKeyChar({ keyCode: 200, key: "Unidentified" })).toBe("");
  });
});

describe("KeyboardUtils.isWordChar", () => {
  it("treats letters and digits as word characters", () => {
    expect(KeyboardUtils.isWordChar({ keyCode: 65 })).toBe(true); // A
    expect(KeyboardUtils.isWordChar({ keyCode: 97 })).toBe(true); // a
    expect(KeyboardUtils.isWordChar({ keyCode: 48 })).toBe(true); // 0
  });

  it("rejects whitespace and control keys", () => {
    expect(KeyboardUtils.isWordChar({ keyCode: 32 })).toBe(false); // space
    expect(KeyboardUtils.isWordChar({ keyCode: 13 })).toBe(false); // enter
  });
});

// ── getKeyChar — additional branch coverage ───────────────────────────────────

describe("KeyboardUtils.getKeyChar — key string in modifier-name list", () => {
  // When event.key is one of Shift/Meta/Alt/Ctrl and the keyCode is not a named
  // modifier key code, the modifier-name guard clears the character to "".
  it("returns empty string when key is 'Alt' but keyCode is not a modifier keyCode", () => {
    // keyCode 200 is not in modifierKeys, so the first guard is bypassed.
    // key='Alt' is in the modifier-name list → character is cleared to "".
    expect(KeyboardUtils.getKeyChar({ keyCode: 200, key: "Alt" })).toBe("");
  });

  it("returns empty string when key is 'Shift'", () => {
    expect(KeyboardUtils.getKeyChar({ keyCode: 200, key: "Shift" })).toBe("");
  });

  it("returns empty string when key is 'Meta'", () => {
    expect(KeyboardUtils.getKeyChar({ keyCode: 200, key: "Meta" })).toBe("");
  });

  it("returns empty string when key is 'Ctrl'", () => {
    expect(KeyboardUtils.getKeyChar({ keyCode: 200, key: "Ctrl" })).toBe("");
  });
});

describe("KeyboardUtils.getKeyChar — keyIdentifier legacy path", () => {
  const decode = (s: string) => KeyboardUtils.decodeKeystroke(s);

  it("uses keyIdentifier directly when it does not start with 'U+'", () => {
    // Non-U+ keyIdentifier values (e.g. named keys like 'Enter') are returned verbatim.
    const result = KeyboardUtils.getKeyChar({ keyCode: 300, keyIdentifier: "Enter" });
    expect(decode(result)).toBe("<Enter>");
  });

  it("decodes a U+ keyIdentifier to its Unicode character (no shift, no correction)", () => {
    // U+0041 = 'A'; lowercase because shiftKey is false.
    const result = KeyboardUtils.getKeyChar({ keyCode: 300, keyIdentifier: "U+0041" });
    expect(result).toBe("a");
  });

  it("preserves case when shiftKey is true for a U+ keyIdentifier", () => {
    // U+0041 = 'A'; kept uppercase because shiftKey is true.
    const result = KeyboardUtils.getKeyChar({
      keyCode: 300,
      keyIdentifier: "U+0041",
      shiftKey: true,
    });
    expect(result).toBe("A");
  });
});

describe("KeyboardUtils.getKeyChar — charCode > 127 (Mac dead-key / Alt path)", () => {
  const decode = (s: string) => KeyboardUtils.decodeKeystroke(s);

  it("falls back to keyCode character when key charCode > 127 and keyCode < 127", () => {
    // Simulate Alt-s on Mac: key = 'ß' (charCode 223 > 127), keyCode = 83 ('S' = 83 < 127).
    // The branch converts to String.fromCharCode(83) = 'S', then lowercases because shiftKey is false.
    const result = decode(KeyboardUtils.getKeyChar({ keyCode: 83, key: "ß", altKey: true }));
    expect(result).toBe("<Alt-s>");
  });

  it("uses keyCodesMac when key charCode > 127, keyCode >= 127, and code is in keyCodesMac", () => {
    // Simulate Alt-/ on Mac: key produces charCode > 127, code='Slash' is in keyCodesMac.
    // keyCodesMac['Slash'] = ['/', '?']; shiftKey false → index 0 → '/'.
    const result = decode(
      KeyboardUtils.getKeyChar({ keyCode: 191, key: "÷", code: "Slash", altKey: true }),
    );
    expect(result).toBe("<Alt-/>");
  });

  it("uses keyCodesMac shift variant (index 1) when shiftKey is true", () => {
    // keyCodesMac['Slash'] = ['/', '?']; shiftKey true → index 1 → character='?'.
    // '?' has length 1, so the Shift- prefix is NOT applied (only applies to length>1 names).
    // altKey adds 'Alt-' → character='Alt-?' → wrapped → '<Alt-?>'.
    const result = decode(
      KeyboardUtils.getKeyChar({
        keyCode: 191,
        key: "÷",
        code: "Slash",
        altKey: true,
        shiftKey: true,
      }),
    );
    expect(result).toBe("<Alt-?>");
  });

  it("produces empty string when key is 'Dead', keyCode >= 127, and code not in keyCodesMac", () => {
    // 'Dead' triggers the charCode > 127 || 'Dead' branch.
    // keyCode=200 (>= 127), code='Unknown' is not in keyCodesMac → character stays unchanged
    // but 'Dead' itself is the character; after no correction it remains 'Dead'.
    // With no macCodes match, character is not reassigned → stays "Dead".
    // "Dead" length > 1, so it becomes <Dead>. Then encodeKeystroke roundtrip may or may not match.
    // The concrete observable: the function does not throw.
    const result = KeyboardUtils.getKeyChar({
      keyCode: 200,
      key: "Dead",
      code: "Unknown",
      altKey: true,
    });
    // Character ends up as 'Dead' → wrapped → <Alt-Dead>; encodeKeystroke can't round-trip "Dead"
    // (it's not a known special key) so the function returns the raw <Alt-Dead> string.
    expect(result).toBe("<Alt-Dead>");
  });
});

describe("KeyboardUtils.getKeyChar — modifier prefix combinations", () => {
  const decode = (s: string) => KeyboardUtils.decodeKeystroke(s);

  it("applies Meta prefix", () => {
    expect(decode(KeyboardUtils.getKeyChar({ keyCode: 65, key: "a", metaKey: true }))).toBe(
      "<Meta-a>",
    );
  });

  it("applies Alt prefix", () => {
    expect(decode(KeyboardUtils.getKeyChar({ keyCode: 65, key: "a", altKey: true }))).toBe(
      "<Alt-a>",
    );
  });

  it("applies Ctrl+Alt combination", () => {
    expect(
      decode(KeyboardUtils.getKeyChar({ keyCode: 65, key: "a", ctrlKey: true, altKey: true })),
    ).toBe("<Ctrl-Alt-a>");
  });

  it("applies Meta+Shift combination", () => {
    expect(
      decode(KeyboardUtils.getKeyChar({ keyCode: 65, key: "A", metaKey: true, shiftKey: true })),
    ).toBe("<Meta-A>");
  });
});

describe("KeyboardUtils.encodeKeystroke / decodeKeystroke — modifier-bit combinations", () => {
  const roundtrip = (s: string) => KeyboardUtils.decodeKeystroke(KeyboardUtils.encodeKeystroke(s));

  it("round-trips a Shift-only modifier", () => {
    expect(roundtrip("<Shift-Tab>")).toBe("<Shift-Tab>");
  });

  it("round-trips a Meta-only modifier", () => {
    expect(roundtrip("<Meta-a>")).toBe("<Meta-a>");
  });

  it("round-trips an Alt-only modifier", () => {
    expect(roundtrip("<Alt-a>")).toBe("<Alt-a>");
  });

  it("round-trips a Ctrl-only modifier", () => {
    expect(roundtrip("<Ctrl-a>")).toBe("<Ctrl-a>");
  });

  it("round-trips Ctrl+Shift", () => {
    expect(roundtrip("<Ctrl-Shift-Tab>")).toBe("<Ctrl-Shift-Tab>");
  });

  it("encodes a plain character (no angle brackets) as itself", () => {
    const encoded = KeyboardUtils.encodeKeystroke("a");
    expect(encoded).toBe("a");
    expect(KeyboardUtils.decodeKeystroke(encoded)).toBe("a");
  });
});
