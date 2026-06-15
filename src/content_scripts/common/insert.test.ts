import { Result } from "@praha/byethrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineEnv } from "./engineEnv";
import createInsert, { deleteNextWord, nextNonWord } from "./insert";
import KeyboardUtils from "./keyboardUtils";
import { runtime } from "./runtime";

// insert only reaches the seam via getExtensionURL (for the emoji data); the rest are inert stubs.
const makeEnv = (): EngineEnv => ({
  RUNTIME: () => Result.succeed(undefined),
  isInUIFrame: () => false,
  reportIssue: () => {},
  tabOpenLink: () => {},
  getExtensionURL: (path: string) => path,
  log: () => {},
  surfingkeys: undefined,
});

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

// Helper: create a focused editable container that takes the contenteditable
// code paths. The default editableSelector matches `div.CodeMirror-scroll`, so a
// div with that class makes isEditable() true without relying on jsdom's
// (unimplemented) isContentEditable; tabIndex makes it the activeElement so
// getRealEdit() resolves to it; and it has no setSelectionRange, forcing the
// editable branch.
function makeEditableDiv(): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "CodeMirror-scroll";
  div.tabIndex = 0;
  document.body.appendChild(div);
  div.focus();
  return div;
}

describe("createInsert mapping codes", () => {
  let insert: ReturnType<typeof createInsert>;

  beforeEach(() => {
    insert = createInsert(makeEnv());
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
      // cursor starts at 11 (end of "hello world"); moving back one word lands on
      // the space at index 5, as asserted below.
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
      expect(sp("\x1B")).toBe(true);
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

describe("createInsert mapping codes — contenteditable (no setSelectionRange) branch", () => {
  let insert: ReturnType<typeof createInsert>;

  beforeEach(() => {
    insert = createInsert(makeEnv());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moveCursorEOL places the caret at the end of a trailing text node", () => {
    const div = makeEditableDiv();
    const text = document.createTextNode("hello");
    div.appendChild(text);
    getCode(insert, "<Ctrl-e>")!();
    const sel = document.getSelection();
    expect(sel?.focusNode).toBe(text);
    expect(sel?.focusOffset).toBe(5);
  });

  it("moveCursorEOL places the caret after the last child node when it is an element", () => {
    const div = makeEditableDiv();
    const span = document.createElement("span");
    span.append(document.createTextNode("a"), document.createTextNode("b"));
    div.appendChild(span);
    getCode(insert, "<Ctrl-e>")!();
    const sel = document.getSelection();
    // The else arm targets the element node itself at childNodes.length (2).
    expect(sel?.focusNode).toBe(span);
    expect(sel?.focusOffset).toBe(2);
  });

  it("moveCursorEOL collapses the selection to the end for a CodeMirror line child", () => {
    const div = makeEditableDiv();
    // The branch checks `node.querySelector(".CodeMirror-line")` on the last
    // child, so the CodeMirror line must be a descendant of that child, not the
    // child itself.
    const wrapper = document.createElement("div");
    const cmLine = document.createElement("div");
    cmLine.className = "CodeMirror-line";
    cmLine.textContent = "code";
    wrapper.appendChild(cmLine);
    div.appendChild(wrapper);
    getCode(insert, "<Ctrl-e>")!();
    const sel = document.getSelection();
    // setEndOfContenteditable selects the div contents then collapses to end.
    expect(sel?.isCollapsed).toBe(true);
  });

  it("moveCursorEOL does nothing for an empty editable (no child nodes)", () => {
    makeEditableDiv(); // focused editable with no children → getRealEdit resolves to it
    document.getSelection()?.removeAllRanges();
    getCode(insert, "<Ctrl-e>")!();
    // The `childNodes.length > 0` guard is false, so no caret position is set.
    expect(document.getSelection()?.rangeCount).toBe(0);
  });

  it("move-to-BOL sets the caret to offset 0 of the focus node", () => {
    const div = makeEditableDiv();
    const text = document.createTextNode("hello");
    div.appendChild(text);
    document.getSelection()?.setPosition(text, 5);
    const keyToBOL = KeyboardUtils.platform === "Windows" ? "<Ctrl-f>" : "<Ctrl-a>";
    getCode(insert, keyToBOL)!();
    const sel = document.getSelection();
    expect(sel?.focusNode).toBe(text);
    expect(sel?.focusOffset).toBe(0);
  });

  it("delete-to-beginning (<Ctrl-u>) trims the focus text node up to the caret", () => {
    const div = makeEditableDiv();
    const text = document.createTextNode("hello world");
    div.appendChild(text);
    document.getSelection()?.setPosition(text, 6);
    getCode(insert, "<Ctrl-u>")!();
    // focus.data becomes data.substring(focusOffset) → "world".
    expect(text.data).toBe("world");
  });
});

describe("createInsert moveCursorEOL — setSelectionRange failure handling", () => {
  let insert: ReturnType<typeof createInsert>;

  beforeEach(() => {
    insert = createInsert(makeEnv());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("swallows an InvalidStateError thrown by setSelectionRange", () => {
    const input = makeInput("abc", 0);
    input.setSelectionRange = () => {
      throw new DOMException("not applicable", "InvalidStateError");
    };
    // The InvalidStateError arm is swallowed, so invoking the code must not throw.
    expect(() => getCode(insert, "<Ctrl-e>")!()).not.toThrow();
    expect(input.value).toBe("abc");
  });

  it("rethrows any non-InvalidStateError from setSelectionRange", () => {
    const input = makeInput("abc", 0);
    const boom = new DOMException("nope", "IndexSizeError");
    input.setSelectionRange = () => {
      throw boom;
    };
    expect(() => getCode(insert, "<Ctrl-e>")!()).toThrow(boom);
  });
});

// Helper to retrieve the keydown handler registered via addEventListener.
function getKeydownHandler(insert: ReturnType<typeof createInsert>): (event: any) => void {
  return (insert as any).eventListeners["keydown"];
}

// Helper to retrieve the focus handler registered via addEventListener.
function getFocusHandler(insert: ReturnType<typeof createInsert>): (event: any) => void {
  return (insert as any).eventListeners["focus"];
}

describe("createInsert keydown event listener", () => {
  let insert: ReturnType<typeof createInsert>;

  beforeEach(() => {
    insert = createInsert(makeEnv());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sets sk_suppressed when the key has charCode > 127 (IME open)", () => {
    // A Japanese character has charCode > 127; this simulates an IME composition key.
    const input = makeInput("hello", 0);
    const handler = getKeydownHandler(insert);
    const event: any = { key: "あ", target: input, sk_keyName: "" };
    handler(event);
    expect(event.sk_suppressed).toBe(true);
  });

  it("exits insert mode when the focused element is not editable", () => {
    // A non-editable element (e.g. document.body) causes exit.
    const div = document.createElement("div");
    document.body.appendChild(div);
    div.focus();
    const exitSpy = vi.spyOn(insert, "exit");
    const handler = getKeydownHandler(insert);
    const event: any = { key: "a", target: div, sk_keyName: "a" };
    handler(event);
    expect(exitSpy).toHaveBeenCalledOnce();
  });

  it("sets sk_suppressed=true at end of handler for a mapped editable key", () => {
    const input = makeInput("hello", 0);
    const handler = getKeydownHandler(insert);
    const event: any = {
      key: "a",
      target: input,
      sk_keyName: KeyboardUtils.encodeKeystroke("<Ctrl-e>"),
      isTrusted: false,
    };
    handler(event);
    // The handler always sets sk_suppressed=true at the bottom of the keydown branch.
    expect(event.sk_suppressed).toBe(true);
  });

  it("does not set sk_suppressed from IME branch when key is ASCII", () => {
    const input = makeInput("hello", 0);
    const handler = getKeydownHandler(insert);
    // Regular ASCII key should NOT trigger the IME early-return branch.
    const event: any = { key: "a", target: input, sk_keyName: "" };
    handler(event);
    // The IME guard does not fire; sk_suppressed is set by the bottom of the handler.
    // (sk_keyName is empty so handleMapKey is not called, but sk_suppressed is still set)
    expect(event.sk_suppressed).toBe(true);
  });
});

describe("createInsert focus event listener", () => {
  let insert: ReturnType<typeof createInsert>;

  beforeEach(() => {
    insert = createInsert(makeEnv());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exits insert mode when a non-editable element receives focus", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const exitSpy = vi.spyOn(insert, "exit");
    const handler = getFocusHandler(insert);
    // target is div (not window), and div is not editable → exit.
    const event: any = { target: div };
    handler(event);
    expect(exitSpy).toHaveBeenCalledOnce();
  });

  it("sets sk_suppressed when an editable element receives focus", () => {
    const input = makeInput("hello", 0);
    const handler = getFocusHandler(insert);
    const event: any = { target: input };
    handler(event);
    expect(event.sk_suppressed).toBe(true);
  });

  it("sets sk_suppressed when target is window (window-lost-focus event)", () => {
    // When event.target === window, getRealEdit returns document.body.
    // isEditable(document.body) is false, but the guard is target !== window,
    // so the else branch fires and sk_suppressed is set.
    const handler = getFocusHandler(insert);
    const event: any = { target: window };
    handler(event);
    expect(event.sk_suppressed).toBe(true);
  });
});

describe("createInsert enter override", () => {
  let insert: ReturnType<typeof createInsert>;

  afterEach(() => {
    document.body.innerHTML = "";
    runtime.conf.showModeStatus = false;
    runtime.conf.cursorAtEndOfInput = true;
  });

  beforeEach(() => {
    insert = createInsert(makeEnv());
  });

  it("sets showModeStatus=false when the element is document.body", () => {
    runtime.conf.showModeStatus = true;
    insert.enter(document.body);
    expect(runtime.conf.showModeStatus).toBe(false);
  });

  it("moves the cursor to end of input when entering a new element with cursorAtEndOfInput", () => {
    runtime.conf.cursorAtEndOfInput = true;
    const input = makeInput("hello world", 0);
    insert.enter(input);
    // moveCursorEOL should have moved the caret to position 11.
    expect(input.selectionStart).toBe(11);
  });

  it("does not move cursor when keepCursor is true", () => {
    runtime.conf.cursorAtEndOfInput = true;
    const input = makeInput("hello world", 0);
    insert.enter(input, true);
    // cursor should remain at 0 because keepCursor=true suppresses moveCursorEOL.
    expect(input.selectionStart).toBe(0);
  });

  it("does not move cursor when cursorAtEndOfInput is false", () => {
    runtime.conf.cursorAtEndOfInput = false;
    const input = makeInput("hello world", 0);
    insert.enter(input);
    expect(input.selectionStart).toBe(0);
  });

  it("does not move cursor when the element is a SELECT element", () => {
    runtime.conf.cursorAtEndOfInput = true;
    const sel = document.createElement("select");
    document.body.appendChild(sel);
    sel.focus();
    // Install a setSelectionRange spy: if the nodeName!=="SELECT" guard were absent,
    // moveCursorEOL would reach it (getRealEdit returns the focused SELECT). The guard
    // must short-circuit so the spy is never invoked.
    const setSelectionRange = vi.fn();
    (sel as unknown as { setSelectionRange: () => void }).setSelectionRange = setSelectionRange;

    insert.enter(sel);

    expect(setSelectionRange).not.toHaveBeenCalled();
  });

  it("entering the same element twice does not move cursor on the second call (not changed)", () => {
    runtime.conf.cursorAtEndOfInput = true;
    const input = makeInput("hello world", 0);
    insert.enter(input); // first call: changed=true, moves cursor to 11
    // Move the cursor manually back to position 3 to detect if it moves again.
    input.setSelectionRange(3, 3);
    insert.enter(input); // second call: element === elm → changed=false → cursor stays
    expect(input.selectionStart).toBe(3);
  });
});

describe("nextNonWord — boundary conditions", () => {
  it("stops immediately when the first scanned character is non-word (char is undefined via out-of-bounds)", () => {
    // Scanning forward from position 2 in "ab" (length 2): cur becomes 3, which
    // is >= str.length → clamps to 2.
    expect(nextNonWord("ab", 1, 1)).toBe(2);
  });

  it("moves backward and stops at the first non-word character encountered", () => {
    // "a.b": scanning backward from 2 → cur becomes 1 → ch='.' (non-word) → stops at 1.
    expect(nextNonWord("a.b", -1, 2)).toBe(1);
  });
});

describe("deleteNextWord — pos === cur fallthrough (single-char deletion)", () => {
  it("deletes forward when pos equals cur (character under cursor is non-word)", () => {
    // nextNonWord(".", 1, 0) → cur becomes 1 (>=length) → pos=1; pos > cur → delete right.
    // Wait: nextNonWord starts at cur+dir=1 → 1 >= 1 (length of ".") → clamps to 1.
    // pos=1 > cur=0 → s = "".substring(0,0) + ".".substring(1) = "".
    expect(deleteNextWord(".", 1, 0)).toEqual(["", 0]);
  });

  it("deletes backward when pos equals cur at start of string", () => {
    // nextNonWord(".", -1, 0) → cur becomes -1 → clamps to 0; pos=0 === cur=0.
    // pos === cur: deletes str[pos..pos+1] → "".substring(0,0) + ".".substring(1) = "".
    expect(deleteNextWord(".", -1, 0)).toEqual(["", 0]);
  });
});
