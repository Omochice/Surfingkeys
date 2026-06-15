import { unwrapOr } from "../../common/result";
import { dispatchSKEvent } from "./events";
import KeyboardUtils from "./keyboardUtils";
import { createKeymap } from "./keymap";
import { ModeHandle, showModeStatus } from "./mode";
import { RUNTIME, runtime } from "./runtime";
import { isSpecialKeyOf } from "./specialKeys";
import Trie from "./trie";
import type { TrieMeta } from "./trie";
import {
  actionWithSelectionPreserved,
  dispatchMouseEvent,
  filterAncestors,
  flashPressedLink,
  getBrowserName,
  getTextNodes,
  getTextRect,
  getVisibleElements,
  getWordUnderCursor,
  locateFocusNode,
  setSanitizedContent,
} from "./utils";

type ClipboardLike = { write(text: string): void };
type HintsLike = {
  create(
    cssSelector: string | Element[] | RegExp,
    // Mirrors hints.create: the hint target is polymorphic and the callback is typed per callsite.
    // eslint-disable-next-line typescript/no-explicit-any
    onHintKey: ((element: any) => void) | null,
    attrs?: Record<string, unknown>,
  ): Promise<number>;
};

type Match = [Node, number, HTMLElement[]];

/**
 * The visual-mode controller. It wraps a private {@link ModeHandle} rather than being one, so the
 * base mode members it relies on are surfaced explicitly: `name` / `mappings` feed api.ts and the
 * frontend registry, `eventListeners` lets the hub (and tests) dispatch key / scroll / click
 * events, `statusLine` is a read-only view of the handle's status line, and `enter` / `exit` /
 * `onEnter` / `onExit` drive the mode's own state machine. The rest are the visual operations
 * callers invoke.
 */
type VisualMode = {
  eventListeners: ModeHandle["eventListeners"];
  name: string;
  mappings: Trie;
  readonly statusLine: string | undefined;
  enter(): void;
  exit(): void;
  onEnter?(): void;
  onExit?(): void;
  hideCursor(): void;
  showCursor(): void;
  getCursorPixelPos(): DOMRect;
  visualClear(): void;
  emptySelection(): void;
  restore(): void;
  toggle(ex?: string): void;
  star(): void;
  next(backward?: boolean): void;
  feedkeys(keys: string): void;
  visualUpdate(query: string): void;
  visualEnter(query: string): void;
  findSentenceOf(query: string): string;
  style(element: string, style: string): void;
};

// window.find is a non-standard method the lib types omit.
const win = window as unknown as {
  find(
    aString: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrapAround?: boolean,
    wholeWord?: boolean,
  ): boolean;
};

function createVisual(clipboard: ClipboardLike, hints: HintsLike): VisualMode {
  const mode = new ModeHandle("Visual");
  const mappings = new Trie();
  const keymap = createKeymap(() => mappings, { enableRepeats: true });

  mode.addEventListener("keydown", (event) => {
    const keyName = event.sk_keyName ?? "";
    if (visualf) {
      let exitf = false;
      event.sk_stopPropagation = true;
      event.sk_suppressed = true;

      if (KeyboardUtils.isWordChar(event as KeyboardEvent)) {
        visualSeek(visualf, keyName);
        lastF = [visualf, keyName];
        exitf = true;
      } else if (isSpecialKeyOf("<Esc>", keyName)) {
        exitf = true;
      }

      if (exitf) {
        mode.statusLine = mode.name + " - " + status[state];
        showModeStatus();
        visualf = 0;
      }
    } else if (keyName.length) {
      keymap.handleKey(event);
      if (event.sk_stopPropagation) {
        event.sk_suppressed = true;
      } else if (isSpecialKeyOf("<Esc>", keyName)) {
        if (state > 1) {
          self.hideCursor();
          selection.collapse(selection.anchorNode, selection.anchorOffset);
          self.showCursor();
        } else {
          self.visualClear();
          self.exit();
        }
        state--;
        onStateChange();
        event.sk_stopPropagation = true;
        event.sk_suppressed = true;
      }
    }
  });
  mode.addEventListener("scroll", () => {
    matches.forEach((m) => {
      const r = unwrapOr<DOMRectList | DOMRect[]>(getTextRect(m[0], m[1]), [])[0];
      if (r == null) {
        return;
      }
      m[2].forEach((mi) => {
        mi.style.left = document.scrollingElement!.scrollLeft + r.left + "px";
        mi.style.top = document.scrollingElement!.scrollTop + r.top + "px";
      });
    });
  });

  mode.addEventListener("click", () => {
    switch (selection.type) {
      case "None": {
        self.hideCursor();
        state = 0;
        break;
      }
      case "Caret": {
        if (state) {
          self.hideCursor();
          if (state === 0) {
            state = 1;
          }
          self.showCursor();
        }
        break;
      }
      case "Range": {
        if (state) {
          self.hideCursor();
          state = 2;
          self.showCursor();
        }
        break;
      }
    }
    onStateChange();
  });

  mode.addEventListener("resize", () => {
    if (runtime.conf.lastQuery) {
      self.visualUpdate(runtime.conf.lastQuery);
    }
    const cur = matches[currentOccurrence];
    if (cur) {
      select(cur);
    }
  });
  let selectionMark: HTMLElement[] | null = null;
  const clearSelectionMark = () => {
    if (selectionMark) {
      selectionMark.forEach((m) => {
        m.remove();
      });
    }
  };
  mode.addEventListener("selectionchange", () => {
    clearSelectionMark();
    selectionMark = createSelectionMark(
      selection.anchorNode,
      selection.anchorOffset,
      selection.focusNode,
      selection.focusOffset,
    );
  });

  mappings.add("l", {
    annotation: "forward character",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("h", {
    annotation: "backward character",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("j", {
    annotation: "forward line",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("k", {
    annotation: "backward line",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("w", {
    annotation: "forward word",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("e", {
    annotation: "forward word",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("b", {
    annotation: "backward word",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add(")", {
    annotation: "forward sentence",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("(", {
    annotation: "backward sentence",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("}", {
    annotation: "forward paragraphboundary",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("{", {
    annotation: "backward paragraphboundary",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("0", {
    annotation: "backward lineboundary",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("$", {
    annotation: "forward lineboundary",
    feature_group: 9,
    code: modifySelection,
  });
  mappings.add("G", {
    annotation: "forward documentboundary",
    feature_group: 9,
    code: () => {
      document.scrollingElement!.scrollTop = document.scrollingElement!.scrollHeight;
      if (getBrowserName() !== "Firefox") {
        modifySelection();
      } else {
        self.hideCursor();
        selection.setPosition(document.body.lastChild, 0);
        self.showCursor();
      }
      if (matches.length) {
        currentOccurrence = matches.length - 1;
        dispatchSKEvent("front", [
          "showStatus",
          [undefined, undefined, currentOccurrence + 1 + " / " + matches.length],
        ]);
      }
    },
  });
  mappings.add("gg", {
    annotation: "backward documentboundary",
    feature_group: 9,
    code: () => {
      // there may be some fixed-position div for navbar on top on some pages.
      // so scrollIntoView can not send us top, as it's already in view.
      // explicitly set scrollTop 0 here.
      document.scrollingElement!.scrollTop = 0;
      currentOccurrence = 0;
      if (matches.length) {
        dispatchSKEvent("front", [
          "showStatus",
          [undefined, undefined, currentOccurrence + 1 + " / " + matches.length],
        ]);
      }

      if (getBrowserName() !== "Firefox") {
        modifySelection();
      } else {
        self.hideCursor();
        selection.setPosition(document.body.firstChild, 0);
        self.showCursor();
      }
    },
  });

  mappings.add("o", {
    annotation: "Go to Other end of highlighted text",
    feature_group: 9,
    code: () => {
      self.hideCursor();
      const pos: [Node | null, number] = [selection.anchorNode, selection.anchorOffset];
      selection.collapse(selection.focusNode, selection.focusOffset);
      selection.extend(pos[0]!, pos[1]);
      self.showCursor();
    },
  });
  const units: Record<string, string> = {
    w: "word",
    l: "lineboundary",
    s: "sentence",
    p: "paragraphboundary",
  };
  function selectUnit(w: string): void {
    if (getBrowserName() !== "Firefox" || (w !== "p" && w !== "s")) {
      const unit = units[w];
      // sentence and paragraphboundary not support in firefox
      // document.getSelection().modify("move", "backward", "paragraphboundary")
      // gets 0x80004001 (NS_ERROR_NOT_IMPLEMENTED)
      selection.modify("extend", "forward", unit);
    }
  }
  const yankFunctions: Array<Omit<TrieMeta, "word">> = [
    {},
    {
      annotation: "Yank a word(w) or line(l) or sentence(s) or paragraph(p)",
      feature_group: 9,
      code: (w: string) => {
        const pos: [Node | null, number] = [selection.focusNode, selection.focusOffset];
        self.hideCursor();
        selectUnit(w);
        clipboard.write(selection.toString());
        selection.collapseToStart();
        selection.setPosition(pos[0], pos[1]);
        self.showCursor();
      },
    },
    {
      annotation: "Copy selected text",
      feature_group: 9,
      code: () => {
        const pos: [Node | null, number] = [selection.focusNode, selection.focusOffset];
        clipboard.write(selection.toString());
        if (runtime.conf.modeAfterYank === "Caret") {
          selection.setPosition(pos[0], pos[1]);
          self.showCursor();
          state = 1;
          onStateChange();
        } else if (runtime.conf.modeAfterYank === "Normal") {
          state = 2;
          self.toggle();
        }
      },
    },
  ];
  mappings.add("*", {
    annotation: "Search word under the cursor",
    feature_group: 9,
    code: () => {
      self.star();
    },
  });
  function clickLink(element: Element, shiftKey: boolean): void {
    flashPressedLink(element, () => {
      dispatchMouseEvent(element, ["click"], { shiftKey });
    });
  }
  mappings.add(KeyboardUtils.encodeKeystroke("<Enter>"), {
    annotation: "Click on node under cursor.",
    feature_group: 9,
    code: () => {
      clickLink(selection.focusNode!.parentNode as Element, false);
    },
  });
  mappings.add(KeyboardUtils.encodeKeystroke("<Shift-Enter>"), {
    annotation: "Click on node under cursor.",
    feature_group: 9,
    code: () => {
      clickLink(selection.focusNode!.parentNode as Element, true);
    },
  });
  mappings.add("zt", {
    annotation: "make cursor at top of window.",
    feature_group: 9,
    code: () => {
      const offset = cursor.getBoundingClientRect().top;
      self.hideCursor();
      document.scrollingElement!.scrollTop += offset;
      self.showCursor();
    },
  });
  mappings.add("zz", {
    annotation: "make cursor at center of window.",
    feature_group: 9,
    code: () => {
      const offset = cursor.getBoundingClientRect().top - window.innerHeight / 2;
      self.hideCursor();
      document.scrollingElement!.scrollTop += offset;
      self.showCursor();
    },
  });
  mappings.add("zb", {
    annotation: "make cursor at bottom of window.",
    feature_group: 9,
    code: () => {
      const offset = window.innerHeight - cursor.getBoundingClientRect().bottom;
      self.hideCursor();
      document.scrollingElement!.scrollTop -= offset;
      self.showCursor();
    },
  });
  mappings.add("f", {
    annotation: "Forward to next char.",
    feature_group: 9,
    code: () => {
      mode.statusLine = mode.name + " - " + status[state] + " - forward";
      showModeStatus();
      visualf = 1;
    },
  });
  mappings.add("F", {
    annotation: "Backward to next char.",
    feature_group: 9,
    code: () => {
      mode.statusLine = mode.name + " - " + status[state] + " - backward";
      showModeStatus();
      visualf = -1;
    },
  });
  mappings.add(";", {
    annotation: "Repeat latest f, F",
    feature_group: 9,
    code: () => {
      if (lastF) {
        visualSeek(lastF[0], lastF[1]);
      }
    },
  });
  mappings.add(",", {
    annotation: "Repeat latest f, F in opposite direction",
    feature_group: 9,
    code: () => {
      if (lastF) {
        visualSeek(-lastF[0], lastF[1]);
      }
    },
  });

  mappings.add("p", {
    annotation: "Expand selection to parent element",
    feature_group: 9,
    code: () => {
      let p = selection.focusNode as (Node & { parentElement: HTMLElement | null }) | null;
      while (p && p !== document.body) {
        p = p.parentElement;
        const textNodes = getTextNodes(p!, /./);
        const firstNode = textNodes[0];
        const lastNode = textNodes.at(-1) as Text | undefined;
        if (firstNode == null || lastNode == null) {
          continue;
        }
        const range = selection.getRangeAt(0);
        if (
          range.comparePoint(firstNode, 0) === -1 ||
          range.comparePoint(lastNode, lastNode.length) === 1
        ) {
          self.hideCursor();
          state = 2;
          onStateChange();
          selection.setBaseAndExtent(firstNode, 0, lastNode, lastNode.length);
          self.showCursor();
          break;
        }
      }
    },
  });

  mappings.add("V", {
    annotation: "Select a word(w) or line(l) or sentence(s) or paragraph(p)",
    feature_group: 9,
    code: (w: string) => {
      self.hideCursor();
      state = 2;
      onStateChange();
      selectUnit(w);
      self.showCursor();
    },
  });

  const selection = document.getSelection()!;
  let matches: Match[] = [];
  let currentOccurrence = 0;
  let state = 0;
  const status = ["", "Caret", "Range"];
  const mark_template = document.createElement("div");
  const cursor = document.createElement("div");
  cursor.className = "surfingkeys_cursor";
  cursor.style.zIndex = "2147483299";

  // f in visual mode
  let visualf = 0;
  let lastF: [number, string] | null = null;

  function visualSeek(dir: number, chr: string): void {
    self.hideCursor();
    const lastPosBeforeF: [Node | null, number] = [selection.anchorNode, selection.anchorOffset];
    if (
      selection.focusNode &&
      selection.focusNode.textContent &&
      selection.focusNode.textContent.length &&
      selection.focusNode.textContent[selection.focusOffset] === chr &&
      dir === 1
    ) {
      // if the char after cursor is the char to find, forward one step.
      selection.setPosition(selection.focusNode, selection.focusOffset + 1);
    }
    if (findNextTextNodeBy(chr, true, dir === -1)) {
      if (state === 1) {
        selection.setPosition(selection.focusNode, selection.focusOffset - 1);
      } else {
        const found: [Node | null, number] = [selection.focusNode, selection.focusOffset - 1];
        selection.collapseToStart();
        selection.setPosition(lastPosBeforeF[0], lastPosBeforeF[1]);
        selection.extend(found[0]!, found[1]);
      }
    } else {
      selection.setPosition(lastPosBeforeF[0], lastPosBeforeF[1]);
    }
    self.showCursor();
  }

  function getTextNodeByY(y: number): Node | null {
    let node: Node | null = null;
    const treeWalker = getTextNodes(document.body, /./, 0);
    while (treeWalker.nextNode()) {
      const parent = treeWalker.currentNode.parentNode;
      if (!(parent instanceof Element)) {
        continue;
      }
      const br = parent.getBoundingClientRect();
      if (br.top > window.innerHeight * y) {
        node = treeWalker.currentNode;
        break;
      }
    }
    return node;
  }

  const hideCursor = (): void => {
    if (document.body.contains(cursor)) {
      cursor.remove();
      dispatchSKEvent("front", ["hideBubble"]);
    }
  };

  const showCursor = (): void => {
    if (
      selection.focusNode &&
      ((selection.focusNode instanceof HTMLElement && selection.focusNode.offsetHeight > 0) ||
        (selection.focusNode.parentNode instanceof HTMLElement &&
          selection.focusNode.parentNode.offsetHeight > 0))
    ) {
      // https://developer.mozilla.org/en-US/docs/Web/API/Selection
      // If focusNode is a text node, this is the number of characters within focusNode preceding the focus. If focusNode is an element, this is the number of child nodes of the focusNode preceding the focus.
      const r = locateFocusNode(selection);
      if (r) {
        cursor.style.position = "fixed";
        cursor.style.left = r.left + "px";
        cursor.style.top = r.top + "px";
        cursor.style.height = r.height + "px";
      }

      document.body.appendChild(cursor);
    }
  };
  const getCursorPixelPos = (): DOMRect => {
    return cursor.getBoundingClientRect();
  };

  function select(found: Match): void {
    self.hideCursor();
    if (selection.anchorNode && state === 2) {
      selection.extend(found[0], found[1]);
    } else {
      selection.setPosition(found[0], found[1]);
    }
    self.showCursor();
  }

  function modifySelection(): void {
    const sel = (keymap.getCurrentNode().meta!.annotation as string).split(" ");
    const alter = state === 2 ? "extend" : "move";
    self.hideCursor();
    const prevPos: [Node | null, number] = [selection.focusNode, selection.focusOffset];
    selection.modify(alter, sel[0], sel[1]);

    if (prevPos[0] === selection.focusNode && prevPos[1] === selection.focusOffset) {
      selection.modify(alter, sel[0], "word");
    }
    self.showCursor();
  }

  const markHolder = document.createElement("div");
  function createMark(
    className: string,
    node1: Node,
    offset1: number,
    node2: Node,
    offset2: number,
  ): HTMLElement[] {
    const rects = unwrapOr<DOMRectList | DOMRect[]>(
      getTextRect(node1, offset1, node2, offset2),
      [],
    );
    if (rects.length > 100) {
      // avoid hangs due to huge amounts of selection
      return [];
    }
    const marks = Array.from(rects)
      .map((r) => {
        if (r.width > 0 && r.height > 0) {
          const mark = mark_template.cloneNode(false) as HTMLElement;
          mark.className = className;
          mark.style.position = "absolute";
          mark.style.zIndex = "2147483299";
          mark.style.left = document.scrollingElement!.scrollLeft + r.left + "px";
          mark.style.top = document.scrollingElement!.scrollTop + r.top + "px";
          mark.style.width = r.width + "px";
          mark.style.height = r.height + "px";
          markHolder.appendChild(mark);
          return mark;
        }
        return null;
      })
      .filter((m): m is HTMLElement => m !== null);
    if (marks.length && !document.documentElement.contains(markHolder)) {
      document.documentElement.prepend(markHolder);
    }
    return marks;
  }
  function createSelectionMark(
    node1: Node | null,
    offset1: number,
    node2: Node | null,
    offset2: number,
  ): HTMLElement[] {
    if (!node1 || !node2) return [];
    return createMark("surfingkeys_selection_mark", node1, offset1, node2, offset2);
  }
  function createMatchMark(node1: Node, offset1: number, node2: Node, offset2: number): void {
    const marks = createMark("surfingkeys_match_mark", node1, offset1, node2, offset2);

    if (marks.length) {
      matches.push([node1, offset1, marks]);
    }
  }

  function highlight(pattern: RegExp): void {
    const gpattern = new RegExp(pattern.source, "g" + pattern.flags);
    getTextNodes(document.body, pattern).forEach((node) => {
      if (!(node instanceof Text)) {
        return;
      }
      const data = node.data;
      let matches;
      while ((matches = gpattern.exec(data)) !== null) {
        const match = matches[0];
        if (match.length) {
          const pos = gpattern.lastIndex - match.length;
          createMatchMark(node, pos, node, pos + match.length);
        } else {
          // matches like \b
          break;
        }
      }
    });
    if (matches.length) {
      currentOccurrence = 0;
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const firstElement = m && m[2][0];
        if (!firstElement) {
          continue;
        }
        const br = firstElement.getBoundingClientRect();
        if (br.top > 0) {
          currentOccurrence = i;
          break;
        }
      }
      dispatchSKEvent("front", [
        "showStatus",
        [undefined, undefined, currentOccurrence + 1 + " / " + matches.length],
      ]);
    }
  }

  const visualClear = (): void => {
    clearSelectionMark();
    self.hideCursor();
    matches = [];
    setSanitizedContent(markHolder, "");
    markHolder.remove();
    dispatchSKEvent("front", ["showStatus", [undefined, undefined, ""]]);
  };

  const emptySelection = (): void => {
    document.getSelection()!.empty();
  };

  mode.onEnter = () => {
    incState();
  };

  mode.onExit = () => {
    self.visualClear();
  };

  function onStateChange(): void {
    const yankFn = yankFunctions[state];
    if (yankFn != null) {
      mappings.add("y", yankFn);
    }
    mode.statusLine = mode.name + " - " + (status[state] ?? "");
    showModeStatus();
  }
  function incState(): void {
    state = (state + 1) % 3;
    onStateChange();
  }

  const restore = (): void => {
    if (selection && selection.anchorNode) {
      selection.setPosition(selection.anchorNode, selection.anchorOffset);
      self.showCursor();
      self.enter();
    }
  };
  const toggle = (ex?: string): void => {
    switch (state) {
      case 1: {
        selection.extend(selection.anchorNode!, selection.anchorOffset);
        incState();
        break;
      }
      case 2: {
        self.hideCursor();
        selection.collapse(selection.focusNode, selection.focusOffset);
        self.exit();
        incState();
        break;
      }
      default: {
        hints.create(runtime.conf.textAnchorPat, (element) => {
          setTimeout(() => {
            selection.setPosition(element[0], element[1]);
            self.enter();
            if (ex === "z") {
              if (element[1] === 0) {
                selection.extend(element[0], element[0].textContent.length);
              } else {
                selection.extend(element[0], element[1] + element[2].length);
              }
              incState();
            }
            self.showCursor();
          }, 0);
        });
        break;
      }
    }
  };

  const star = (): void => {
    if (selection.focusNode && selection.focusNode.nodeValue) {
      const query = getWordUnderCursor();
      if (query && query.length && query !== ".") {
        self.hideCursor();
        const pos: [Node | null, number] = [selection.focusNode, selection.focusOffset];
        RUNTIME("updateInputHistory", { find: query });
        self.visualClear();
        highlight(new RegExp(query, runtime.getCaseSensitive(query) ? "" : "i"));
        selection.setPosition(pos[0], pos[1]);
        self.showCursor();
      }
    }
  };

  const next = (backward?: boolean): void => {
    if (matches.length) {
      // need enter visual mode again when modeAfterYank is set to Normal / Caret.
      if (state === 0) {
        self.enter();
      }
      currentOccurrence =
        (backward ? matches.length + currentOccurrence - 1 : currentOccurrence + 1) %
        matches.length;
      const next = matches[currentOccurrence];
      if (next) {
        select(next);
      }
      dispatchSKEvent("front", [
        "showStatus",
        [undefined, undefined, currentOccurrence + 1 + " / " + matches.length],
      ]);
    } else if (runtime.conf.lastQuery) {
      highlight(
        new RegExp(
          runtime.conf.lastQuery,
          runtime.getCaseSensitive(runtime.conf.lastQuery) ? "" : "i",
        ),
      );
      self.visualEnter(runtime.conf.lastQuery);
    }
  };

  const feedkeys = (keys: string): void => {
    setTimeout(() => {
      const evt = new Event("keydown");
      for (const ch of keys) {
        evt.sk_keyName = ch;
        keymap.handleKey(evt);
      }
    }, 1);
  };

  function findNextTextNodeBy(query: string, caseSensitive: boolean, backwards: boolean): boolean {
    let found = false;
    // window.find sometimes does not move selection forward
    let firstNode: Node | null = null;
    while (win.find(query, caseSensitive, backwards)) {
      if (selection.anchorNode instanceof Text) {
        found = true;
        break;
      } else if (firstNode === null) {
        firstNode = selection.anchorNode;
      } else if (firstNode === selection.anchorNode) {
        break;
      }
    }
    return found;
  }
  const visualUpdate = (query: string): void => {
    self.visualClear();

    // set caret to top in view
    selection.setPosition(getTextNodeByY(0), 0);

    let scrollTop = document.scrollingElement!.scrollTop,
      posToStartFind: [Node | null, number] = [selection.anchorNode, selection.anchorOffset];

    const caseSensitive = runtime.getCaseSensitive(query);
    if (findNextTextNodeBy(query, caseSensitive, false)) {
      selection.setPosition(posToStartFind[0], posToStartFind[1]);
    } else {
      // start from beginning if no found from current position
      selection.setPosition(document.body.firstChild, 0);
    }

    if (findNextTextNodeBy(query, caseSensitive, false)) {
      if (document.scrollingElement!.scrollTop !== scrollTop) {
        // set new start position if there is no occurrence in current view.
        scrollTop = document.scrollingElement!.scrollTop;
        posToStartFind = [selection.anchorNode, selection.anchorOffset];
      }
      createMatchMark(
        selection.anchorNode!,
        selection.anchorOffset,
        selection.focusNode!,
        selection.focusOffset,
      );

      while (
        document.scrollingElement!.scrollTop === scrollTop &&
        findNextTextNodeBy(query, caseSensitive, false)
      ) {
        createMatchMark(
          selection.anchorNode!,
          selection.anchorOffset,
          selection.focusNode!,
          selection.focusOffset,
        );
      }
      document.scrollingElement!.scrollTop = scrollTop;
      selection.setPosition(posToStartFind[0], posToStartFind[1]);
    }
  };

  const visualEnter = (query: string): void => {
    if (query.length === 0 || query === ".") {
      return;
    }
    self.visualClear();
    highlight(new RegExp(query, runtime.getCaseSensitive(query) ? "" : "i"));
    if (matches.length) {
      self.enter();
      const cur = matches[currentOccurrence];
      if (cur) {
        select(cur);
      }
    } else {
      dispatchSKEvent("front", [
        "showStatus",
        [undefined, undefined, `Pattern not found: ${query}`],
        1000,
      ]);
    }
  };

  const findSentenceOf = (query: string): string => {
    const wr = new RegExp(String.raw`\b` + query + String.raw`\b`);
    let elements = getVisibleElements((e, v) => {
      if (wr.test(e.innerText)) {
        v.push(e);
      }
    });
    elements = filterAncestors(elements) as HTMLElement[];

    let sentence = "";
    const firstElement = elements[0];
    if (firstElement == null) {
      return sentence;
    }
    actionWithSelectionPreserved((sel) => {
      sel!.setPosition(firstElement, 0);
      if (win.find(query, false, false, true, true)) {
        selectUnit("s");
        sentence = selection.toString();
      }
    });
    return sentence;
  };

  const styleMap: Record<string, string> = {};
  /**
   * Set styles for visual mode.
   *
   * @example
   *   Visual.style("marks", "background-color: #89a1e2;");
   *   Visual.style("cursor", "background-color: #9065b7;");
   *
   * @param {string} element Element in visual mode, which can be `marks` and `cursor`.
   * @param {string} style Css style
   * @name Visual.style
   */
  const style = (element: string, style: string): void => {
    styleMap[element] = style;

    cursor.setAttribute("style", styleMap["cursor"] || "");
    mark_template.setAttribute("style", styleMap["marks"] || "");
  };

  const self: VisualMode = {
    // The hub dispatches events through the private handle's listener map; sharing the reference
    // keeps the keydown/scroll/click/resize/selectionchange listeners registered above observable
    // through the controller. `statusLine` is read-only because the handle owns it and the hub reads
    // it off the stacked handle; `onEnter` / `onExit` mirror the handle's lifecycle hooks.
    eventListeners: mode.eventListeners,
    name: mode.name,
    get statusLine() {
      return mode.statusLine;
    },
    mappings,
    enter() {
      mode.enter();
    },
    exit() {
      mode.exit();
    },
    onEnter: mode.onEnter,
    onExit: mode.onExit,
    hideCursor,
    showCursor,
    getCursorPixelPos,
    visualClear,
    emptySelection,
    restore,
    toggle,
    star,
    next,
    feedkeys,
    visualUpdate,
    visualEnter,
    findSentenceOf,
    style,
  };

  return self;
}

export default createVisual;
