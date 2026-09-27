import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEmojiPrompt } from "./emojiPrompt";

// jsdom has no layout engine, so scrollIntoView and getBoundingClientRect, which
// activate() reaches through its render path, are not functional.
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

const fixtures = ["0x1f600\tgrinning", "0x1f601\tgrin", "0x1f602\tjoy"];

describe("createEmojiPrompt", () => {
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

  it("renders candidates matching the query typed after the activator", () => {
    const emojiPrompt = createEmojiPrompt("unused://emoji.tsv");

    input.value = ":";
    input.setSelectionRange(1, 1);
    emojiPrompt.activate(input, { data: fixtures, threshold: 2 });

    input.value = ":gri";
    input.setSelectionRange(4, 4);
    emojiPrompt.onKeyUp();

    const rendered = Array.from(emojiPrompt.element.children).map((el) => el.textContent);
    expect(rendered).toEqual(["😀grinning", "😁grin"]);

    emojiPrompt.close();
  });

  it("does not match a query found only in the codepoint column", () => {
    const emojiPrompt = createEmojiPrompt("unused://emoji.tsv");

    input.value = ":";
    input.setSelectionRange(1, 1);
    emojiPrompt.activate(input, { data: fixtures, threshold: 2 });

    input.value = ":1f6";
    input.setSelectionRange(4, 4);
    emojiPrompt.onKeyUp();

    expect(document.body.contains(emojiPrompt.element)).toBe(false);
  });

  it("does not match the '0x' codepoint prefix", () => {
    const emojiPrompt = createEmojiPrompt("unused://emoji.tsv");

    input.value = ":";
    input.setSelectionRange(1, 1);
    emojiPrompt.activate(input, { data: fixtures, threshold: 2 });

    input.value = ":0x";
    input.setSelectionRange(3, 3);
    emojiPrompt.onKeyUp();

    expect(document.body.contains(emojiPrompt.element)).toBe(false);
  });
});
