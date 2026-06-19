import KeyboardUtils from "./keyboardUtils";
import { createKeymap } from "./keymap";
import { ModeHandle } from "./mode";
import Trie from "./trie";
import {
  createElementWithContent,
  locateFocusNode,
  scrollIntoViewIfNeeded,
  setSanitizedContent,
} from "./utils";

type Renderer = (choice: string) => string;
type Picker = (selected: Element) => string;
type Fetcher = () => Promise<string[]>;

// The prompt attaches to either a native input/textarea or a contenteditable node.
type InputLike = HTMLInputElement | HTMLTextAreaElement;

class CursorPrompt {
  element: HTMLElement;
  renderer: Renderer;
  picker: Picker;
  fetcher: Fetcher;
  mode!: ModeHandle;
  insertOffset = 0;
  threshold = 0;
  parentElement!: HTMLElement;
  isNativeInput = false;
  matchStart = -1;
  activator: string | undefined = "";
  data?: string[];
  #suppressKeyup = false;

  constructor(renderer: Renderer, picker: Picker, fetcher: Fetcher) {
    this.element = createElementWithContent("div", "", {
      class: "sk_cursor_prompt",
      style: "display: block; opacity: 1;",
    });
    this.renderer = renderer;
    this.picker = picker;
    this.fetcher = fetcher;
    this.initMode();
  }

  initMode(): void {
    const mode = new ModeHandle("CursorPrompt");
    const mappings = new Trie();
    const keymap = createKeymap(() => mappings);

    mode.addEventListener("keydown", (event) => {
      if (event.sk_keyName?.length) {
        keymap.handleKey(event);
      }
      event.sk_suppressed = true;
    });
    mode.addEventListener("keyup", () => this.onKeyUp());

    mappings.add(KeyboardUtils.encodeKeystroke("<Esc>"), {
      code: () => this.close(),
    });
    mappings.add(KeyboardUtils.encodeKeystroke("<Enter>"), {
      code: () => this.onEnter(),
    });
    mappings.add(KeyboardUtils.encodeKeystroke("<Tab>"), {
      code: () => this.rotate(false),
    });
    mappings.add(KeyboardUtils.encodeKeystroke("<Shift-Tab>"), {
      code: () => this.rotate(true),
    });
    this.mode = mode;
  }

  activate(
    parentElement: HTMLElement,
    data?: string[],
    threshold?: number,
    insertOffset?: number,
  ): void {
    this.insertOffset = insertOffset || 0;
    this.threshold = threshold || 0;
    this.parentElement = parentElement;
    // A native input/textarea exposes a non-null selectionStart and value; a
    // contenteditable node lacks them. Detect by probing the properties directly.
    this.isNativeInput =
      "selectionStart" in parentElement &&
      "value" in parentElement &&
      parentElement.selectionStart != null &&
      parentElement.value != null;
    let value = "";
    [value, this.matchStart] = this.#getValueAndSelectionStart();
    this.activator = value[this.matchStart - 1];

    if (data && data.length) {
      this.data = data;
    }

    if (this.data) {
      this.#render();
    } else if (this.fetcher) {
      this.fetcher().then((res) => {
        this.data = res;
        this.#render();
      });
    }

    this.#suppressKeyup = false;

    this.mode.enter();
  }

  rotate(backward: boolean): void {
    const items = Array.from(this.element.children);
    if (items.length === 1) {
      this.onEnter();
      return;
    }
    const si = this.element.querySelector("div.selected")!;
    const ci = (items.indexOf(si) + (backward ? -1 : 1)) % items.length;
    si.classList.remove("selected");
    const next = items[ci];
    if (next) {
      next.classList.add("selected");
    }
    this.#suppressKeyup = true;
  }

  onEnter(): void {
    const d = this.picker(this.element.querySelector("div.selected")!);
    const newPos = this.matchStart + d.length;

    if (this.isNativeInput) {
      const input = this.#requireNativeInput();
      const val = input.value;
      input.value =
        val.slice(0, this.matchStart + this.insertOffset) +
        d +
        val.slice(input.selectionStart ?? 0);
      input.setSelectionRange(newPos, newPos);
    } else {
      // for contenteditable div
      const selection = document.getSelection()!;
      const focus = this.#requireTextFocus(selection);
      const val = focus.data;
      focus.data =
        val.slice(0, this.matchStart + this.insertOffset) + d + val.slice(selection.focusOffset);
      selection.setPosition(focus, newPos);
    }

    this.close();
    this.matchStart = -1;
  }

  #getValueAndSelectionStart(): [string, number] {
    if (this.isNativeInput) {
      const input = this.#requireNativeInput();
      return [input.value, input.selectionStart ?? 0];
    }
    // for contenteditable div
    const selection = document.getSelection()!;
    const focus = this.#requireTextFocus(selection);
    return [focus.data, selection.focusOffset];
  }

  // `isNativeInput` is set from a duck-typed probe; these helpers re-narrow the
  // stored HTMLElement to the concrete type that the probe already guaranteed.
  #requireNativeInput(): InputLike {
    const el = this.parentElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el;
    }
    throw new Error("CursorPrompt: parentElement is not a native input");
  }

  #requireTextFocus(selection: Selection): Text {
    const focus = selection.focusNode;
    if (focus instanceof Text) {
      return focus;
    }
    throw new Error("CursorPrompt: selection focus is not a text node");
  }

  onKeyUp(): void {
    if (!this.#suppressKeyup && this.matchStart !== -1) {
      const [v, ss] = this.#getValueAndSelectionStart();
      if (ss < this.matchStart || v[this.matchStart - 1] !== this.activator) {
        this.element.remove();
      } else {
        this.#render();
      }
    }
    this.#suppressKeyup = false;
  }

  close(): void {
    this.element.remove();
    this.mode.exit();
  }

  #render(): void {
    let query = "";
    if (this.isNativeInput) {
      const input = this.#requireNativeInput();
      query = input.value.slice(this.matchStart, input.selectionStart ?? 0);
    } else {
      // for contenteditable div
      const selection = document.getSelection()!;
      const focus = this.#requireTextFocus(selection);
      query = focus.data.slice(this.matchStart, selection.focusOffset);
    }
    if (query.length < this.threshold || query[0] === " ") {
      this.element.remove();
    } else {
      const choices = this.data!.filter((c) => c.includes(query))
        .slice(0, 5)
        .map(this.renderer)
        .join("");

      if (choices === "") {
        this.element.remove();
      } else {
        setSanitizedContent(this.element, choices);
        document.body.append(this.element);
        this.element.firstElementChild!.classList.add("selected");
        const br = (
          this.isNativeInput
            ? this.#getCursorPixelPos(this.#requireNativeInput())
            : locateFocusNode(document.getSelection())
        )!;
        let top = br.top + br.height + 4;
        this.element.style.borderRadius = "0px 0px 4px 4px";
        if (window.innerHeight - top < this.element.offsetHeight) {
          top = br.top - this.element.offsetHeight;
          this.element.style.borderRadius = "4px 4px 0px 0px";
        }

        this.element.style.position = "fixed";
        this.element.style.top = top + "px";
        this.element.style.left = br.left + "px";
      }
    }
  }

  #getCursorPixelPos(input: InputLike): DOMRect {
    const css = getComputedStyle(input);
    let br = input.getBoundingClientRect();
    const mask = document.createElement("div");
    const span = document.createElement("span");
    mask.style.font = css.font;
    mask.style.position = "fixed";
    setSanitizedContent(mask, input.value);
    mask.style.left = input.clientLeft + br.left + "px";
    mask.style.top = input.clientTop + br.top + "px";
    mask.style.color = "red";
    mask.style.overflow = "scroll";
    mask.style.visibility = "hidden";
    mask.style.whiteSpace = "pre-wrap";
    mask.style.padding = css.padding;
    mask.style.width = css.width;
    mask.style.height = css.height;
    span.innerText = "I";

    const pos = input.selectionStart ?? 0;
    if (pos === input.value.length) {
      mask.appendChild(span);
    } else {
      const firstChild = mask.childNodes[0];
      if (firstChild instanceof Text) {
        const fp = firstChild.splitText(pos);
        fp.before(span);
      }
    }
    document.body.appendChild(mask);
    scrollIntoViewIfNeeded(span);

    br = span.getBoundingClientRect();

    mask.remove();
    return br;
  }
}

export default CursorPrompt;
