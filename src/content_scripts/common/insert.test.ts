import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import createInsert, { deleteNextWord, nextNonWord } from "./insert";
import KeyboardUtils from "./keyboardUtils";

describe("nextNonWord", () => {
  it("moves forward to the first non-word character after the cursor", () => {
    expect(nextNonWord("hello world", 1, 0)).toBe(5);
  });

  it("clamps to the string length when moving forward past the last word", () => {
    expect(nextNonWord("hello world", 1, 5)).toBe(11);
    expect(nextNonWord("foo", 1, 0)).toBe(3);
  });

  it("moves backward to the preceding non-word character", () => {
    expect(nextNonWord("hello world", -1, 11)).toBe(5);
  });

  it("clamps to the start when moving backward past the first word", () => {
    expect(nextNonWord("hello world", -1, 5)).toBe(0);
    expect(nextNonWord("foo", -1, 3)).toBe(0);
  });

  it("treats punctuation as a word boundary", () => {
    expect(nextNonWord("a.b", 1, 0)).toBe(1);
    expect(nextNonWord("a.b", 1, 1)).toBe(3);
  });

  it("stays at the boundary for an empty string", () => {
    expect(nextNonWord("", 1, 0)).toBe(0);
    expect(nextNonWord("", -1, 0)).toBe(0);
  });
});

describe("deleteNextWord", () => {
  it("deletes forward from the cursor to the next word boundary", () => {
    expect(deleteNextWord("hello world", 1, 0)).toEqual([" world", 0]);
    expect(deleteNextWord("foo bar", 1, 0)).toEqual([" bar", 0]);
  });

  it("deletes backward from the cursor to the previous word boundary", () => {
    expect(deleteNextWord("hello world", -1, 11)).toEqual(["hello", 5]);
    expect(deleteNextWord("foo bar", -1, 7)).toEqual(["foo", 3]);
  });

  it("deletes the character under the clamped position when motion stays put", () => {
    expect(deleteNextWord("a", -1, 0)).toEqual(["", 0]);
  });
});

// Helper: look up a mapping's code by keystroke string from the Insert mode trie.
function getCode(
  insert: ReturnType<typeof createInsert>,
  keystroke: string,
): (() => void) | undefined {
  const encoded = KeyboardUtils.encodeKeystroke(keystroke);
  const node = insert.mappings.find(encoded);
  // meta.code is typed as `(...args: string[]) => void` in the trie; use any here
  // to avoid a cast and recover a plain zero-argument callable.
  const code: any = node?.meta?.code;
  return code;
}

// Helper: create a focused input with a given value and cursor position.
function makeInput(value: string, cursorPos: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  document.body.appendChild(input);
  input.value = value;
  input.focus();
  input.setSelectionRange(cursorPos, cursorPos);
  return input;
}

// Helper: create a focused textarea with a given value and cursor position.
function makeTextarea(value: string, cursorPos: number): HTMLTextAreaElement {
  const ta = document.createElement("textarea");
  document.body.appendChild(ta);
  ta.value = value;
  ta.focus();
  ta.setSelectionRange(cursorPos, cursorPos);
  return ta;
}

describe("createInsert mapping codes", () => {
  let insert: ReturnType<typeof createInsert>;

  beforeEach(() => {
    insert = createInsert();
  });

  afterEach(() => {
    // Remove any DOM elements added during the test.
    document.body.innerHTML = "";
  });

  describe("moveCursorEOL (<Ctrl-e>)", () => {
    it("moves the caret to end of an input value", () => {
      const input = makeInput("hello world", 0);
      const code = getCode(insert, "<Ctrl-e>");
      expect(code).toBeDefined();
      code!();
      expect(input.selectionStart).toBe(11);
      expect(input.selectionEnd).toBe(11);
    });

    it("stays at the end when the caret is already at the end", () => {
      const input = makeInput("abc", 3);
      const code = getCode(insert, "<Ctrl-e>");
      code!();
      expect(input.selectionStart).toBe(3);
    });

    it("works for a textarea", () => {
      const ta = makeTextarea("line one\nline two", 0);
      const code = getCode(insert, "<Ctrl-e>");
      code!();
      expect(ta.selectionStart).toBe(17);
    });
  });

  describe("moveCursorBOL (<Ctrl-a>)", () => {
    it("moves the caret to the start of an input value", () => {
      const input = makeInput("hello world", 6);
      // On non-Windows platforms the key is <Ctrl-a>; on Windows it is <Ctrl-f>.
      const keystroke = KeyboardUtils.platform === "Windows" ? "<Ctrl-f>" : "<Ctrl-a>";
      const code = getCode(insert, keystroke);
      expect(code).toBeDefined();
      code!();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(0);
    });

    it("stays at the start when the caret is already at the start", () => {
      const keystroke = KeyboardUtils.platform === "Windows" ? "<Ctrl-f>" : "<Ctrl-a>";
      const input = makeInput("abc", 0);
      const code = getCode(insert, keystroke);
      code!();
      expect(input.selectionStart).toBe(0);
    });
  });

  describe("delete-to-beginning (<Ctrl-u>)", () => {
    it("deletes all characters before the cursor", () => {
      const input = makeInput("hello world", 5);
      const code = getCode(insert, "<Ctrl-u>");
      expect(code).toBeDefined();
      code!();
      expect(input.value).toBe(" world");
      expect(input.selectionStart).toBe(0);
    });

    it("leaves value unchanged when cursor is already at position 0", () => {
      const input = makeInput("hello", 0);
      const code = getCode(insert, "<Ctrl-u>");
      code!();
      expect(input.value).toBe("hello");
      expect(input.selectionStart).toBe(0);
    });

    it("clears the entire value when the cursor is at the end", () => {
      const input = makeInput("abc", 3);
      const code = getCode(insert, "<Ctrl-u>");
      code!();
      expect(input.value).toBe("");
    });
  });

  describe("move backward one word (<Alt-b>)", () => {
    it("moves the caret back by one word", () => {
      // cursor at position 11 (after "hello world"), expect move to after space = 6
      const input = makeInput("hello world", 11);
      const code = getCode(insert, "<Alt-b>");
      expect(code).toBeDefined();
      code!();
      // nextNonWord("hello world", -1, 11) == 5 (space position)
      expect(input.selectionStart).toBe(5);
      expect(input.selectionEnd).toBe(5);
    });

    it("clamps to 0 when already at or near the start", () => {
      const input = makeInput("hello", 3);
      const code = getCode(insert, "<Alt-b>");
      code!();
      expect(input.selectionStart).toBe(0);
    });
  });

  describe("move forward one word (<Alt-f>)", () => {
    it("moves the caret forward by one word", () => {
      const input = makeInput("hello world", 0);
      const code = getCode(insert, "<Alt-f>");
      expect(code).toBeDefined();
      code!();
      // nextNonWord("hello world", 1, 0) == 5
      expect(input.selectionStart).toBe(5);
      expect(input.selectionEnd).toBe(5);
    });

    it("clamps to string length when past the last word", () => {
      const input = makeInput("foo", 1);
      const code = getCode(insert, "<Alt-f>");
      code!();
      expect(input.selectionStart).toBe(3);
    });
  });

  describe("delete word backwards (<Alt-w>)", () => {
    it("deletes the word before the cursor", () => {
      const input = makeInput("hello world", 11);
      const code = getCode(insert, "<Alt-w>");
      expect(code).toBeDefined();
      code!();
      // deleteNextWord("hello world", -1, 11) == ["hello", 5]
      expect(input.value).toBe("hello");
      expect(input.selectionStart).toBe(5);
    });

    it("removes only up to the word boundary, leaving subsequent text intact", () => {
      const input = makeInput("foo bar", 7);
      const code = getCode(insert, "<Alt-w>");
      code!();
      expect(input.value).toBe("foo");
      expect(input.selectionStart).toBe(3);
    });

    it("at position 0 deletes the first character (pos == cur fallthrough)", () => {
      const input = makeInput("a", 0);
      const code = getCode(insert, "<Alt-w>");
      code!();
      expect(input.value).toBe("");
    });
  });

  describe("delete word forwards (<Alt-d>)", () => {
    it("deletes the word after the cursor", () => {
      const input = makeInput("hello world", 0);
      const code = getCode(insert, "<Alt-d>");
      expect(code).toBeDefined();
      code!();
      // deleteNextWord("hello world", 1, 0) == [" world", 0]
      expect(input.value).toBe(" world");
      expect(input.selectionStart).toBe(0);
    });

    it("deletes from mid-word to the next boundary", () => {
      const input = makeInput("foo bar", 0);
      const code = getCode(insert, "<Alt-d>");
      code!();
      expect(input.value).toBe(" bar");
      expect(input.selectionStart).toBe(0);
    });
  });

  describe("exit (<Esc>)", () => {
    it("blurs the active element and exits the mode", () => {
      const input = makeInput("hello", 0);
      const blurSpy = vi.spyOn(input, "blur");
      const exitSpy = vi.spyOn(insert, "exit");
      const code = getCode(insert, "<Esc>");
      expect(code).toBeDefined();
      code!();
      expect(blurSpy).toHaveBeenCalledOnce();
      expect(exitSpy).toHaveBeenCalledOnce();
    });
  });

  describe("stopPropagation on <Esc>", () => {
    it("returns true for ASCII keys (charCode < 256)", () => {
      const encoded = KeyboardUtils.encodeKeystroke("<Esc>");
      const node = insert.mappings.find(encoded);
      const sp: any = node?.meta?.stopPropagation;
      expect(typeof sp).toBe("function");
      // comma is ASCII
      expect(sp(",")).toBe(true);
      // ESC character itself (charCode 27)
      expect(sp("\x1b")).toBe(true);
    });
  });

  describe("enableEmojiInsertion", () => {
    it("registers a `:` mapping after enableEmojiInsertion() is called", () => {
      expect(insert.mappings.find(":")).toBeUndefined();
      insert.enableEmojiInsertion();
      const node = insert.mappings.find(":");
      expect(node).toBeDefined();
      expect(node?.meta?.annotation).toBe("Input emoji");
    });

    it("the `:` mapping has stopPropagation that always returns false", () => {
      insert.enableEmojiInsertion();
      const node = insert.mappings.find(":");
      const sp: any = node?.meta?.stopPropagation;
      expect(typeof sp).toBe("function");
      expect(sp()).toBe(false);
    });
  });

  describe("initial mappings are registered", () => {
    it("has a mapping for <Ctrl-e>", () => {
      const node = insert.mappings.find(KeyboardUtils.encodeKeystroke("<Ctrl-e>"));
      expect(node?.meta?.annotation).toBe("Move the cursor to the end of the line");
    });

    it("has a mapping for <Ctrl-u>", () => {
      const node = insert.mappings.find(KeyboardUtils.encodeKeystroke("<Ctrl-u>"));
      expect(node?.meta?.annotation).toBe("Delete all entered characters before the cursor");
    });

    it("has a mapping for <Alt-b>", () => {
      const node = insert.mappings.find(KeyboardUtils.encodeKeystroke("<Alt-b>"));
      expect(node?.meta?.annotation).toBe("Move the cursor Backward 1 word");
    });

    it("has a mapping for <Alt-f>", () => {
      const node = insert.mappings.find(KeyboardUtils.encodeKeystroke("<Alt-f>"));
      expect(node?.meta?.annotation).toBe("Move the cursor Forward 1 word");
    });

    it("has a mapping for <Alt-w>", () => {
      const node = insert.mappings.find(KeyboardUtils.encodeKeystroke("<Alt-w>"));
      expect(node?.meta?.annotation).toBe("Delete a word backwards");
    });

    it("has a mapping for <Alt-d>", () => {
      const node = insert.mappings.find(KeyboardUtils.encodeKeystroke("<Alt-d>"));
      expect(node?.meta?.annotation).toBe("Delete a word forwards");
    });

    it("has a mapping for <Esc>", () => {
      const node = insert.mappings.find(KeyboardUtils.encodeKeystroke("<Esc>"));
      expect(node?.meta?.annotation).toBe("Exit insert mode");
    });
  });
});
