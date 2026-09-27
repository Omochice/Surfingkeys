import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEmojiPrompt } from "./emojiPrompt";

// jsdom does not implement Element#innerText (it silently no-ops), so the real htmlEncode, which
// renders through it, always returns "" here; stand in with the escaping a real browser produces.
vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    htmlEncode: (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
  };
});

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

const fixtures: [string, string, string][] = [
  ["😀", "grinning_face", "grinning face"],
  ["😁", "beaming_face_with_smiling_eyes", "beaming face with smiling eyes"],
  ["😂", "face_with_tears_of_joy", "face with tears of joy"],
  ["🇧🇦", "flag_bosnia_herzegovina", "flag: Bosnia & Herzegovina"],
];

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

  it("renders the candidate matching the query typed after the activator", () => {
    const emojiPrompt = createEmojiPrompt("unused://emoji.json");

    input.value = ":";
    input.setSelectionRange(1, 1);
    emojiPrompt.activate(input, { data: fixtures, threshold: 2 });

    input.value = ":grin";
    input.setSelectionRange(5, 5);
    emojiPrompt.onKeyUp();

    const rendered = Array.from(emojiPrompt.element.children).map((el) => el.textContent);
    expect(rendered).toEqual(["😀grinning face"]);

    emojiPrompt.close();
  });

  it("matches by slug rather than the raw emoji character or display name", () => {
    const emojiPrompt = createEmojiPrompt("unused://emoji.json");

    input.value = ":";
    input.setSelectionRange(1, 1);
    emojiPrompt.activate(input, { data: fixtures, threshold: 2 });

    input.value = ":bosnia";
    input.setSelectionRange(7, 7);
    emojiPrompt.onKeyUp();

    const rendered = Array.from(emojiPrompt.element.children).map((el) => el.textContent);
    expect(rendered).toEqual(["🇧🇦flag: Bosnia & Herzegovina"]);

    emojiPrompt.close();
  });

  it("HTML-escapes the rendered name", () => {
    const emojiPrompt = createEmojiPrompt("unused://emoji.json");

    input.value = ":";
    input.setSelectionRange(1, 1);
    emojiPrompt.activate(input, { data: fixtures, threshold: 2 });

    input.value = ":bosnia";
    input.setSelectionRange(7, 7);
    emojiPrompt.onKeyUp();

    expect(emojiPrompt.element.innerHTML).toContain("Bosnia &amp; Herzegovina");
    expect(emojiPrompt.element.innerHTML).not.toContain("Bosnia & Herzegovina");

    emojiPrompt.close();
  });

  it("does not match a query found only in the raw emoji character", () => {
    const emojiPrompt = createEmojiPrompt("unused://emoji.json");

    input.value = ":";
    input.setSelectionRange(1, 1);
    emojiPrompt.activate(input, { data: fixtures, threshold: 2 });

    input.value = ":1f6";
    input.setSelectionRange(4, 4);
    emojiPrompt.onKeyUp();

    expect(document.body.contains(emojiPrompt.element)).toBe(false);
  });

  it("does not match a query found only in the display name", () => {
    const emojiPrompt = createEmojiPrompt("unused://emoji.json");

    input.value = ":";
    input.setSelectionRange(1, 1);
    emojiPrompt.activate(input, { data: fixtures, threshold: 2 });

    input.value = ":0x";
    input.setSelectionRange(3, 3);
    emojiPrompt.onKeyUp();

    expect(document.body.contains(emojiPrompt.element)).toBe(false);
  });
});

describe("createEmojiPrompt fetcher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects when the emoji.json fetch response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    const emojiPrompt = createEmojiPrompt("unused://emoji.json");

    await expect(emojiPrompt.fetcher()).rejects.toThrow();
  });

  it("rejects when the fetched JSON does not match the expected tuple shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ unexpected: "shape" }) })),
    );
    const emojiPrompt = createEmojiPrompt("unused://emoji.json");

    await expect(emojiPrompt.fetcher()).rejects.toThrow();
  });
});
