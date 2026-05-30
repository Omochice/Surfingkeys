import { Result } from "@praha/byethrow";

import { domApiError } from "../../common/result";
import browser from "./browser";
import CursorPrompt from "./cursorPrompt";
import KeyboardUtils from "./keyboardUtils";
import Mode from "./mode";
import { runtime } from "./runtime";
import Trie from "./trie";
import { getRealEdit, isEditable } from "./utils";

/**
 * Find the offset of the next non-word character from `cur` in `str`, scanning in direction `dir`
 * (+1 forward, -1 backward), clamped to the string bounds.
 */
export function nextNonWord(str: string, dir: number, cur: number): number {
  const nonWord = /\W/;
  cur = cur + dir;
  for (;;) {
    if (cur < 0) {
      cur = 0;
      break;
    } else if (cur >= str.length) {
      cur = str.length;
      break;
    } else {
      const ch = str[cur];
      if (ch === undefined || nonWord.test(ch)) {
        break;
      }
      cur = cur + dir;
    }
  }
  return cur;
}

/**
 * Delete the word adjacent to `cur` in direction `dir`. Returns the resulting string and the cursor
 * offset after the deletion.
 */
export function deleteNextWord(str: string, dir: number, cur: number): [string, number] {
  const pos = nextNonWord(str, dir, cur);
  let s = str;
  if (pos > cur) {
    s = str.substr(0, cur) + str.substr(pos);
  } else if (pos < cur) {
    s = str.substr(0, pos) + str.substr(cur);
  } else {
    s = str.substr(0, pos) + str.substr(pos + 1);
  }
  return [s, dir > 0 ? cur : pos];
}

// `enter` is retyped to the element-entry signature this mode actually exposes
// to callers (normal/hints focus an editable). The base Mode.enter (the
// stack-push) is still used internally; it is reached through a localized cast
// below. `mappings`/`map_node` are required here because createInsert always
// assigns them, which lets InsertMode satisfy the structural mode interfaces.
type InsertMode = Omit<Mode, "enter"> & {
  enter(elm: HTMLElement, keepCursor?: boolean): void;
  enableEmojiInsertion(): void;
  mappings: Trie;
  map_node: Trie;
};

function createInsert(): InsertMode {
  const self = new Mode("Insert") as unknown as InsertMode;

  function moveCursorEOL(): void {
    const element = getRealEdit();
    if (element.setSelectionRange !== undefined) {
      const r = Result.try({
        try: (): void => {
          element.setSelectionRange(element.value.length, element.value.length);
        },
        catch: (cause) => domApiError("setSelectionRange", cause),
      });
      if (Result.isFailure(r)) {
        const { cause } = r.error;
        // InvalidStateError means setSelectionRange does not apply to this element.
        if (!(cause instanceof DOMException && cause.name === "InvalidStateError")) {
          throw cause;
        }
      }
    } else if (isEditable(element)) {
      // for contenteditable div
      if (element.childNodes.length > 0) {
        const node = element.childNodes[element.childNodes.length - 1];
        if (node.nodeType === Node.TEXT_NODE) {
          document.getSelection()!.setPosition(node, node.data.length);
        } else if (node.querySelector(".CodeMirror-line")) {
          setEndOfContenteditable(element);
        } else {
          document.getSelection()!.setPosition(node, node.childNodes.length);
        }
      }
    }
  }

  // From https://stackoverflow.com/questions/1125292/how-to-move-cursor-to-end-of-contenteditable-entity/69727327#69727327
  function setEndOfContenteditable(contentEditableElement: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(contentEditableElement);
    // collapse to the end point; false means collapse to end rather than start
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  self.mappings = new Trie();
  self.map_node = self.mappings;
  self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-e>"), {
    annotation: "Move the cursor to the end of the line",
    feature_group: 14,
    code: moveCursorEOL,
  });
  const keyToBOL = KeyboardUtils.platform === "Windows" ? "<Ctrl-f>" : "<Ctrl-a>";
  self.mappings.add(KeyboardUtils.encodeKeystroke(keyToBOL), {
    annotation: "Move the cursor to the beginning of the line",
    feature_group: 14,
    code: () => {
      const element = getRealEdit();
      if (element.setSelectionRange !== undefined) {
        element.setSelectionRange(0, 0);
      } else {
        // for contenteditable div
        const selection = document.getSelection()!;
        selection.setPosition(selection.focusNode, 0);
      }
    },
  });
  self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-u>"), {
    annotation: "Delete all entered characters before the cursor",
    feature_group: 14,
    code: () => {
      const element = getRealEdit();
      if (element.setSelectionRange !== undefined) {
        element.value = element.value.substr(element.selectionStart);
        element.setSelectionRange(0, 0);
      } else {
        // for contenteditable div
        const selection = document.getSelection()!;
        const focus = selection.focusNode as Text;
        focus.data = focus.data.substr(selection.focusOffset);
      }
    },
  });
  self.mappings.add(KeyboardUtils.encodeKeystroke("<Alt-b>"), {
    annotation: "Move the cursor Backward 1 word",
    feature_group: 14,
    code: () => {
      const element = getRealEdit();
      if (element.setSelectionRange !== undefined) {
        const pos = nextNonWord(element.value, -1, element.selectionStart);
        element.setSelectionRange(pos, pos);
      } else {
        // for contenteditable div
        document.getSelection()!.modify("move", "backward", "word");
      }
    },
  });
  self.mappings.add(KeyboardUtils.encodeKeystroke("<Alt-f>"), {
    annotation: "Move the cursor Forward 1 word",
    feature_group: 14,
    code: () => {
      const element = getRealEdit();
      if (element.setSelectionRange !== undefined) {
        const pos = nextNonWord(element.value, 1, element.selectionStart);
        element.setSelectionRange(pos, pos);
      } else {
        // for contenteditable div
        document.getSelection()!.modify("move", "forward", "word");
      }
    },
  });
  self.mappings.add(KeyboardUtils.encodeKeystroke("<Alt-w>"), {
    annotation: "Delete a word backwards",
    feature_group: 14,
    code: () => {
      const element = getRealEdit();
      if (element.setSelectionRange !== undefined) {
        const pos = deleteNextWord(element.value, -1, element.selectionStart);
        element.value = pos[0];
        element.setSelectionRange(pos[1], pos[1]);
      } else {
        // for contenteditable div
        const selection = document.getSelection()!;
        const p0 = selection.focusOffset;
        selection.modify("move", "backward", "word");
        const focus = selection.focusNode as Text;
        const v = focus.data;
        const p1 = selection.focusOffset;
        focus.data = v.substr(0, p1) + v.substr(p0);
        selection.setPosition(focus, p1);
      }
    },
  });
  self.mappings.add(KeyboardUtils.encodeKeystroke("<Alt-d>"), {
    annotation: "Delete a word forwards",
    feature_group: 14,
    code: () => {
      const element = getRealEdit();
      if (element.setSelectionRange !== undefined) {
        const pos = deleteNextWord(element.value, 1, element.selectionStart);
        element.value = pos[0];
        element.setSelectionRange(pos[1], pos[1]);
      } else {
        // for contenteditable div
        const selection = document.getSelection()!;
        const p0 = selection.focusOffset;
        selection.modify("move", "forward", "word");
        const focus = selection.focusNode as Text;
        const v = focus.data;
        const p1 = selection.focusOffset;
        focus.data = v.substr(0, p0) + v.substr(p1);
        selection.setPosition(focus, p0);
      }
    },
  });
  self.mappings.add(KeyboardUtils.encodeKeystroke("<Esc>"), {
    annotation: "Exit insert mode",
    feature_group: 14,
    stopPropagation: (key: string) => {
      // return true only if bind key is not an ASCII key
      // so that imap(',,', "<Esc>") won't leave a comma in input
      return key.charCodeAt(0) < 256;
    },
    code: () => {
      getRealEdit().blur();
      self.exit();
    },
  });

  const emojiURL = browser.runtime.getURL("pages/emoji.tsv");
  const emojiPrompt = new CursorPrompt(
    (c: string) => {
      const ee = c.split("\t");
      const codepoints = ee[0];
      if (codepoints === undefined) {
        return "";
      }
      const parsedUnicodeEmoji = String.fromCodePoint(...codepoints.split(",").map(Number));
      return `<div><span>${parsedUnicodeEmoji}</span>${ee[1]}</div>`;
    },
    (elm: Element) => (elm.firstElementChild as HTMLElement).innerText,
    () =>
      new Promise<string[]>((r) => {
        fetch(emojiURL)
          .then((res) => res.text())
          .then((text) => {
            r(text.split("\n"));
          });
      }),
  );

  self.enableEmojiInsertion = () => {
    self.mappings!.add(":", {
      annotation: "Input emoji",
      feature_group: 14,
      stopPropagation: () => false,
      code: () => {
        setTimeout(() => {
          emojiPrompt.activate(getRealEdit(), undefined, runtime.conf.startToShowEmoji, -1);
        }, 100);
      },
    });
  };

  self.addEventListener("keydown", (event) => {
    const eventKey = (event as KeyboardEvent).key;
    if (eventKey && eventKey.charCodeAt(0) > 127) {
      // IME is opened.
      event.sk_suppressed = true;
      return;
    }
    // prevent this event to be handled by Surfingkeys' other listeners
    const realTarget = getRealEdit(event);
    if (!isEditable(realTarget)) {
      self.exit();
    } else if (event.sk_keyName?.length) {
      Mode.handleMapKey.call(self as unknown as Mode, event, (last) => {
        // for insert mode to insert unmapped chars with preceding chars same as some mapkeys
        // such as, to insert `,m` in case of mapkey `,,` defined.
        const pw = last.getPrefixWord();
        if (pw) {
          let elm = getRealEdit();
          const str = elm.value;
          let pos = elm.selectionStart;
          if (str !== undefined && pos !== undefined) {
            elm.value = str.substr(0, elm.selectionStart) + pw + str.substr(elm.selectionEnd);
            pos += pw.length;
            elm.setSelectionRange(pos, pos);
          } else {
            elm = document.getSelection();
            const range = elm.getRangeAt(0);
            const n = document.createTextNode(pw);
            if (elm.type === "Caret") {
              const data = elm.focusNode.data;
              if (data === undefined) {
                range.insertNode(n);
                elm.setPosition(n, n.length);
              } else {
                pos = elm.focusOffset;
                elm.focusNode.data = data.substr(0, pos) + pw + data.substr(pos);
                elm.setPosition(elm.focusNode, pos + pw.length);
              }
            } else {
              range.deleteContents();
              range.insertNode(n);
              elm.setPosition(n, n.length);
            }
          }
        }
      });
    }
    event.sk_suppressed = true;
  });
  self.addEventListener("focus", (event) => {
    const realTarget = getRealEdit(event);
    // We get a focus event with target = window when the browser window looses focus.
    // Ignore this event.
    if (event.target !== window && !isEditable(realTarget)) {
      self.exit();
    } else {
      event.sk_suppressed = true;
    }
  });

  let _element: HTMLElement | undefined;
  // Capture the base stack-push enter before overriding the public name. The
  // cast reaches Mode.enter through InsertMode's narrowed `enter` slot.
  const _enter = (self as unknown as Mode).enter;
  self.enter = function (elm: HTMLElement, keepCursor?: boolean): void {
    if (elm === document.body) {
      runtime.conf.showModeStatus = false;
    }
    let changed = _enter.call(self as unknown as Mode, 0, true) === -1;
    if (_element !== elm) {
      _element = elm;
      changed = true;
    }
    if (changed && !keepCursor && runtime.conf.cursorAtEndOfInput && elm.nodeName !== "SELECT") {
      moveCursorEOL();
    }
  };

  return self;
}

export default createInsert;
