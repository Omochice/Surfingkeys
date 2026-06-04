import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CursorPrompt from "./cursorPrompt";

// Minimal renderer: wrap the choice in a div for assertable markup.
const renderer = (choice: string) => `<div class="item">${choice}</div>`;
// Minimal picker: return the text content of the selected element.
const picker = (el: Element) => el.textContent ?? "";

describe("CursorPrompt constructor", () => {
  it("creates a div element with class sk_cursor_prompt", () => {
    const cp = new CursorPrompt(renderer, picker, async () => []);
    expect(cp.element.tagName).toBe("DIV");
    expect(cp.element.classList.contains("sk_cursor_prompt")).toBe(true);
  });

  it("stores the renderer, picker and fetcher as instance properties", () => {
    const fetcher = async () => ["a"];
    const cp = new CursorPrompt(renderer, picker, fetcher);
    expect(cp.renderer).toBe(renderer);
    expect(cp.picker).toBe(picker);
    expect(cp.fetcher).toBe(fetcher);
  });
});

// jsdom has no layout engine so scrollIntoView and getBoundingClientRect are
// not functional.  Stub them globally for tests that exercise activate(), which
// triggers #render → #getCursorPixelPos → scrollIntoViewIfNeeded/getBoundingClientRect.
function stubLayout(): () => void {
  const origGetBCR = Element.prototype.getBoundingClientRect;
  const origScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  return () => {
    Element.prototype.getBoundingClientRect = origGetBCR;
    Element.prototype.scrollIntoView = origScrollIntoView;
  };
}

describe("CursorPrompt activate (native input)", () => {
  let input: HTMLInputElement;
  let restoreLayout: () => void;

  beforeEach(() => {
    document.body.replaceChildren();
    input = document.createElement("input");
    document.body.appendChild(input);
    restoreLayout = stubLayout();
  });

  afterEach(() => {
    restoreLayout();
    document.body.replaceChildren();
  });

  it("detects a native input (has selectionStart + value)", () => {
    // "@" sits right before the cursor so the activator is "@"
    input.value = "@foo";
    input.setSelectionRange(4, 4);
    const cp = new CursorPrompt(renderer, picker, async () => []);
    cp.activate(input, ["foo", "bar"]);
    expect(cp.isNativeInput).toBe(true);
    cp.close();
  });

  it("records the activator character from position matchStart-1", () => {
    // For an input "hello@" with cursor at 6, matchStart=6, activator=value[5]="@"
    input.value = "hello@";
    input.setSelectionRange(6, 6);
    const cp = new CursorPrompt(renderer, picker, async () => []);
    cp.activate(input, ["world"]);
    expect(cp.activator).toBe("@");
    cp.close();
  });

  it("uses provided data immediately (no fetcher call needed)", () => {
    const fetcher = vi.fn(async () => []);
    input.value = "x@";
    input.setSelectionRange(2, 2);
    const cp = new CursorPrompt(renderer, picker, fetcher);
    cp.activate(input, ["apple", "apricot", "banana"]);
    // fetcher should NOT be called when data is provided
    expect(fetcher).not.toHaveBeenCalled();
    cp.close();
  });

  it("calls fetcher when no data is provided at activation time", async () => {
    const fetcher = vi.fn(async () => ["fetched"]);
    input.value = "x@";
    input.setSelectionRange(2, 2);
    const cp = new CursorPrompt(renderer, picker, fetcher);
    cp.activate(input);
    expect(fetcher).toHaveBeenCalledOnce();
    cp.close();
  });

  it("stores fetcher results on the instance after resolution", async () => {
    let resolve!: (v: string[]) => void;
    const fetcherPromise = new Promise<string[]>((r) => {
      resolve = r;
    });
    const fetcher = vi.fn(() => fetcherPromise);
    input.value = "x@";
    input.setSelectionRange(2, 2);
    const cp = new CursorPrompt(renderer, picker, fetcher);
    cp.activate(input);
    expect(cp.data).toBeUndefined();
    resolve(["resolved_item"]);
    await fetcherPromise;
    // allow microtasks to flush
    await Promise.resolve();
    expect(cp.data).toEqual(["resolved_item"]);
    cp.close();
  });
});

describe("CursorPrompt onEnter (native input)", () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    document.body.replaceChildren();
    input = document.createElement("input");
    document.body.appendChild(input);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("inserts the picked value into the input at the match position", () => {
    // input: "hello " cursor at 6; data has one match for "" (empty query)
    input.value = "hello ";
    input.setSelectionRange(6, 6);
    const cp = new CursorPrompt(renderer, picker, async () => []);
    // matchStart will be 6 (selectionStart), activator will be value[5]=" "
    // we bypass the render path by directly setting up state:
    cp.insertOffset = 0;
    cp.isNativeInput = true;
    cp.parentElement = input as unknown as HTMLElement;
    cp.matchStart = 6;

    // Inject a selected element into the prompt element manually
    const item = document.createElement("div");
    item.className = "selected";
    item.textContent = "world";
    cp.element.appendChild(item);

    cp.onEnter();

    // The text before matchStart is "hello ", picked value is "world",
    // and everything from selectionStart onward (nothing, since cursor was at end).
    expect(input.value).toBe("hello world");
    // cursor should advance by length of picked value from matchStart
    expect(input.selectionStart).toBe(6 + "world".length);
  });

  it("replaces the mid-word partial with the chosen candidate", () => {
    // input: "say @fo" with cursor at end (pos 7)
    // matchStart = 5 (after the "@"), so we want to replace "fo" with full candidate
    input.value = "say @fo";
    input.setSelectionRange(7, 7);
    const cp = new CursorPrompt(renderer, picker, async () => []);
    cp.isNativeInput = true;
    cp.parentElement = input as unknown as HTMLElement;
    cp.matchStart = 5;
    cp.insertOffset = 0;

    const item = document.createElement("div");
    item.className = "selected";
    item.textContent = "foobar";
    cp.element.appendChild(item);

    cp.onEnter();

    // input.value should be: val.substring(0, 5+0) + "foobar" + val.substring(selectionStart=7)
    // = "say @" + "foobar" + "" = "say @foobar"
    expect(input.value).toBe("say @foobar");
  });

  it("resets matchStart to -1 after enter", () => {
    input.value = "@x";
    input.setSelectionRange(2, 2);
    const cp = new CursorPrompt(renderer, picker, async () => []);
    cp.isNativeInput = true;
    cp.parentElement = input as unknown as HTMLElement;
    cp.matchStart = 1;
    cp.insertOffset = 0;

    const item = document.createElement("div");
    item.className = "selected";
    item.textContent = "xyz";
    cp.element.appendChild(item);

    cp.onEnter();
    expect(cp.matchStart).toBe(-1);
  });
});

describe("CursorPrompt close", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("removes the prompt element from the DOM", () => {
    const cp = new CursorPrompt(renderer, picker, async () => []);
    document.body.appendChild(cp.element);
    expect(document.body.contains(cp.element)).toBe(true);
    cp.close();
    expect(document.body.contains(cp.element)).toBe(false);
  });
});

describe("CursorPrompt rotate", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("moves the selected class to the next item on forward rotation", () => {
    const cp = new CursorPrompt(renderer, picker, async () => []);
    // build two items, first one selected
    const a = document.createElement("div");
    a.className = "selected";
    a.textContent = "alpha";
    const b = document.createElement("div");
    b.textContent = "beta";
    cp.element.append(a, b);

    cp.rotate(false);

    expect(a.classList.contains("selected")).toBe(false);
    expect(b.classList.contains("selected")).toBe(true);
  });

  it("wraps around from last to first on forward rotation", () => {
    const cp = new CursorPrompt(renderer, picker, async () => []);
    const a = document.createElement("div");
    a.textContent = "alpha";
    const b = document.createElement("div");
    b.className = "selected";
    b.textContent = "beta";
    cp.element.append(a, b);

    cp.rotate(false);

    // index (1 + 1) % 2 = 0, so item at index 0 (a) should be selected
    expect(b.classList.contains("selected")).toBe(false);
    expect(a.classList.contains("selected")).toBe(true);
  });

  it("moves selection backward on backward rotation", () => {
    const cp = new CursorPrompt(renderer, picker, async () => []);
    const a = document.createElement("div");
    a.textContent = "alpha";
    const b = document.createElement("div");
    b.className = "selected";
    b.textContent = "beta";
    cp.element.append(a, b);

    cp.rotate(true);

    // index (1 + (-1)) % 2 = 0
    expect(b.classList.contains("selected")).toBe(false);
    expect(a.classList.contains("selected")).toBe(true);
  });

  it("calls onEnter immediately when only one item exists", () => {
    const cp = new CursorPrompt(renderer, picker, async () => []);
    const input = document.createElement("input");
    document.body.appendChild(input);
    cp.isNativeInput = true;
    cp.parentElement = input as unknown as HTMLElement;
    cp.matchStart = 0;
    cp.insertOffset = 0;

    const item = document.createElement("div");
    item.className = "selected";
    item.textContent = "solo";
    cp.element.appendChild(item);

    cp.rotate(false);

    // After onEnter fires, matchStart resets to -1
    expect(cp.matchStart).toBe(-1);
  });
});

describe("CursorPrompt onKeyUp", () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    document.body.replaceChildren();
    input = document.createElement("input");
    document.body.appendChild(input);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("removes the element when the cursor retreats before matchStart", () => {
    input.value = "@foo";
    input.setSelectionRange(2, 2); // cursor now before matchStart
    const cp = new CursorPrompt(renderer, picker, async () => []);
    cp.isNativeInput = true;
    cp.parentElement = input as unknown as HTMLElement;
    cp.matchStart = 4; // cursor is at 2, which is < matchStart
    cp.activator = "@";
    document.body.appendChild(cp.element);

    cp.onKeyUp();

    expect(document.body.contains(cp.element)).toBe(false);
  });

  it("removes the element when the activator character is no longer present", () => {
    // Set input so selectionStart > matchStart but activator char changed
    input.value = "Xfoo";
    input.setSelectionRange(4, 4);
    const cp = new CursorPrompt(renderer, picker, async () => []);
    cp.isNativeInput = true;
    cp.parentElement = input as unknown as HTMLElement;
    cp.matchStart = 1; // selectionStart (4) >= matchStart (1), ok
    cp.activator = "@"; // but value[matchStart-1] = value[0] = "X" !== "@"
    document.body.appendChild(cp.element);

    cp.onKeyUp();

    expect(document.body.contains(cp.element)).toBe(false);
  });

  it("does nothing when matchStart is -1 (prompt is inactive)", () => {
    input.value = "hello";
    input.setSelectionRange(5, 5);
    const cp = new CursorPrompt(renderer, picker, async () => []);
    cp.isNativeInput = true;
    cp.parentElement = input as unknown as HTMLElement;
    cp.matchStart = -1;
    document.body.appendChild(cp.element);

    cp.onKeyUp();

    // element stays because the guard `matchStart !== -1` fires first
    expect(document.body.contains(cp.element)).toBe(true);
    cp.close();
  });
});

describe("CursorPrompt insertOffset", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shifts the insertion point left by insertOffset when entering a choice", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    // With insertOffset = -1 and matchStart = 1, insertion starts at 0.
    // input.value = "@foo", matchStart=1, selectionStart=4
    // result: val.substring(0, 1 + (-1)) + picked + val.substring(4)
    //       = val.substring(0,0) + "bar" + "" = "bar"
    input.value = "@foo";
    input.setSelectionRange(4, 4);

    const cp = new CursorPrompt(renderer, picker, async () => []);
    cp.isNativeInput = true;
    cp.parentElement = input as unknown as HTMLElement;
    cp.matchStart = 1;
    cp.insertOffset = -1;

    const item = document.createElement("div");
    item.className = "selected";
    item.textContent = "bar";
    cp.element.appendChild(item);

    cp.onEnter();

    expect(input.value).toBe("bar");
  });
});
