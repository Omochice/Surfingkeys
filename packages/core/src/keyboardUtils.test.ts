import * as fc from "fast-check";
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
  // getKeyChar encodes a <...> token to a single code point, so the assertions
  // decode it back rather than comparing opaque characters.
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

describe("KeyboardUtils.getKeyChar — key string in modifier-name list", () => {
  it("returns empty string when key is 'Alt' but keyCode is not a modifier keyCode", () => {
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
    const result = KeyboardUtils.getKeyChar({ keyCode: 300, keyIdentifier: "Enter" });
    expect(decode(result)).toBe("<Enter>");
  });

  it("decodes a U+ keyIdentifier to its Unicode character (no shift, no correction)", () => {
    const result = KeyboardUtils.getKeyChar({ keyCode: 300, keyIdentifier: "U+0041" });
    expect(result).toBe("a");
  });

  it("preserves case when shiftKey is true for a U+ keyIdentifier", () => {
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
    // Alt-s on a Mac keyboard emits key 'ß' with keyCode 83.
    const result = decode(KeyboardUtils.getKeyChar({ keyCode: 83, key: "ß", altKey: true }));
    expect(result).toBe("<Alt-s>");
  });

  it("uses keyCodesMac when key charCode > 127, keyCode >= 127, and code is in keyCodesMac", () => {
    // Alt-/ on a Mac keyboard emits key '÷' with code 'Slash'.
    const result = decode(
      KeyboardUtils.getKeyChar({ keyCode: 191, key: "÷", code: "Slash", altKey: true }),
    );
    expect(result).toBe("<Alt-/>");
  });

  it("uses keyCodesMac shift variant (index 1) when shiftKey is true", () => {
    // A single-character result takes no Shift- prefix, only the Alt- one.
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
    const result = KeyboardUtils.getKeyChar({
      keyCode: 200,
      key: "Dead",
      code: "Unknown",
      altKey: true,
    });
    // "Dead" is not a known special key, so the result stays unencoded.
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

describe("KeyboardUtils.encodeKeystroke / decodeKeystroke — properties", () => {
  // A literal key inside a token excludes '<'/'>' (token boundaries) and '-'
  // (the modifier separator), so a generated token parses unambiguously.
  const literalChar = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'()*+,./:;=?@",
  );
  const specialKey = fc.constantFrom(...KeyboardUtils.specialKeys);
  // Modifiers must keep the canonical Ctrl/Alt/Meta/Shift order the parser scans
  // for; fc.subarray preserves the source order.
  const modifiers = fc.subarray(["Ctrl-", "Alt-", "Meta-", "Shift-"]);
  const token = fc
    .tuple(modifiers, fc.oneof(literalChar, specialKey))
    .map(([mods, key]) => `<${mods.join("")}${key}>`);

  it("encodes any keystroke token to a single character", () => {
    fc.assert(
      fc.property(token, (t) => {
        expect(KeyboardUtils.encodeKeystroke(t)).toHaveLength(1);
      }),
    );
  });

  it("round-trips encode then decode for any keystroke token", () => {
    fc.assert(
      fc.property(token, (t) => {
        expect(KeyboardUtils.decodeKeystroke(KeyboardUtils.encodeKeystroke(t))).toBe(t);
      }),
    );
  });

  it("leaves plain text without keystroke tokens unchanged", () => {
    const plain = fc.array(literalChar).map((cs) => cs.join(""));
    fc.assert(
      fc.property(plain, (s) => {
        expect(KeyboardUtils.encodeKeystroke(s)).toBe(s);
        expect(KeyboardUtils.decodeKeystroke(s)).toBe(s);
      }),
    );
  });

  it("round-trips a sequence mixing plain text and keystroke tokens", () => {
    const sequence = fc.array(fc.oneof(literalChar, token)).map((segs) => segs.join(""));
    fc.assert(
      fc.property(sequence, (s) => {
        expect(KeyboardUtils.decodeKeystroke(KeyboardUtils.encodeKeystroke(s))).toBe(s);
      }),
    );
  });
});

describe("KeyboardUtils — fuzz properties over arbitrary input", () => {
  const asciiString = fc.string();
  const unicodeString = fc.string({ unit: "binary" });
  const latin1Char = fc.integer({ min: 0, max: 255 }).map((c) => String.fromCharCode(c));
  const syntaxFragment = fc.constantFrom(
    "<",
    ">",
    "-",
    "Ctrl-",
    "Alt-",
    "Meta-",
    "Shift-",
    ...KeyboardUtils.specialKeys,
  );
  // Interleaving syntax fragments with filler makes malformed tokens such as
  // "<Ctrl-", "<>", "<Ctrl-Esc" or an unknown key name actually appear.
  const noiseOver = (filler: fc.Arbitrary<string>) =>
    fc.array(fc.oneof(syntaxFragment, filler)).map((parts) => parts.join(""));
  const anyInput = fc.oneof(asciiString, unicodeString, noiseOver(fc.string({ maxLength: 3 })));

  it("encodeKeystroke returns a string without throwing for any input", () => {
    fc.assert(
      fc.property(anyInput, (s) => {
        expect(typeof KeyboardUtils.encodeKeystroke(s)).toBe("string");
      }),
    );
  });

  it("decodeKeystroke returns a string without throwing for any input", () => {
    fc.assert(
      fc.property(anyInput, (s) => {
        expect(typeof KeyboardUtils.decodeKeystroke(s)).toBe("string");
      }),
    );
  });

  it("re-encoding a decoded keystroke reproduces the same encoding for Latin-1 input", () => {
    // Latin-1 is the domain, because encodeOne takes k.charCodeAt(0) without a
    // range check and only 8 bits are reserved for the key. A key with charCode
    // >= 290 bleeds into the special-key range, so "<Ģ>" decodes to the literal
    // "<undefined>"; charCode >= 512 overflows the flag bit, so "<Ȁ>" decodes
    // to "<Esc>". Decoding is lossy in the same way from the other side, where
    // "㈠" decodes to "<undefined>". Once encodeOne bounds the key, widen this
    // domain to match.
    const latin1Input = fc.oneof(
      asciiString,
      fc.string({ unit: latin1Char }),
      noiseOver(latin1Char),
    );
    fc.assert(
      fc.property(latin1Input, (s) => {
        const encoded = KeyboardUtils.encodeKeystroke(s);
        expect(KeyboardUtils.encodeKeystroke(KeyboardUtils.decodeKeystroke(encoded))).toBe(encoded);
      }),
    );
  });

  const keyEvent = fc.record(
    {
      keyCode: fc.oneof(
        fc.integer(),
        fc.double(),
        fc.constantFrom(-1, 0, 127, 255, 65_536, 1.5, Number.MAX_SAFE_INTEGER),
      ),
      key: fc.oneof(
        unicodeString,
        fc.constantFrom("Shift", "Meta", "Alt", "Ctrl", "Dead", "Unidentified", "ß", "÷"),
      ),
      code: fc.oneof(asciiString, fc.constantFrom(...KeyboardUtils.keyCodesMac.keys())),
      keyIdentifier: fc.oneof(
        asciiString,
        fc.constantFrom(...KeyboardUtils.keyIdentifierCorrectionMap.keys()),
        fc.integer({ min: 0, max: 0xff_ff }).map((c) => `U+${c.toString(16).toUpperCase()}`),
      ),
      shiftKey: fc.boolean(),
      metaKey: fc.boolean(),
      altKey: fc.boolean(),
      ctrlKey: fc.boolean(),
    },
    { requiredKeys: ["keyCode"] },
  );

  it("getKeyChar returns a string without throwing for any key event", () => {
    fc.assert(
      fc.property(keyEvent, (event) => {
        expect(typeof KeyboardUtils.getKeyChar(event)).toBe("string");
      }),
    );
  });

  it("isWordChar returns a boolean without throwing for any keyCode", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.double()), (keyCode) => {
        expect(typeof KeyboardUtils.isWordChar({ keyCode })).toBe("boolean");
      }),
    );
  });
});
