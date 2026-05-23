import { describe, expect, it } from "vitest";
import KeyboardUtils from "../src/content_scripts/common/keyboardUtils";

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
