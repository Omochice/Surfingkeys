import { SAFE_HTML_OPTIONS, setSanitizedContent } from "@sk/core/utils";
import { describe, expect, it } from "vitest";

// Runs in a real browser (vitest.browser.config.ts): jsdom has no Element.setHTML, and the unit
// suite shims it with DOMPurify, which would mask the real sanitizer dropping class/data-*
// attributes. This pins the behaviour the styling and key-picker hooks depend on, guarding against
// the regression where setHTML's default sanitizer stripped those attributes.
describe("Element.setHTML attribute preservation in a real browser", () => {
  it("keeps the class and data-* attributes that styling and behaviour rely on", () => {
    const el = document.createElement("div");
    el.setHTML(
      '<span class="annotation" data-origin="j" data-custom="gg">x</span>',
      SAFE_HTML_OPTIONS,
    );
    const span = el.querySelector("span");
    expect(span?.className).toBe("annotation");
    expect(span?.dataset.origin).toBe("j");
    expect(span?.dataset.custom).toBe("gg");
  });

  it("still strips scripts, event handlers, and javascript: URLs", () => {
    const el = document.createElement("div");
    el.setHTML(
      '<span class="a" onclick="evil()">x</span><a href="javascript:evil()">y</a><script>evil()</script>',
      SAFE_HTML_OPTIONS,
    );
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("span")?.getAttribute("onclick")).toBeNull();
    expect(el.querySelector("span")?.className).toBe("a");
    expect(el.querySelector("a")?.getAttribute("href")).toBeNull();
  });

  it("keeps style attributes intentionally, matching DOMPurify and the UI that depends on them", () => {
    // The native sanitizer is stricter than DOMPurify, but DOMPurify (the predecessor) also kept
    // style by default, and internal markup relies on it (favicon backgrounds, the omnibar search
    // icon's width, opacity hints). removeAttributes:[] preserves it deliberately; assert on a
    // substring since the browser normalises the style value.
    const el = document.createElement("div");
    el.setHTML('<span style="width: 20px;">x</span>', SAFE_HTML_OPTIONS);
    expect(el.querySelector("span")?.getAttribute("style")).toContain("20px");
  });

  it("preserves attributes through setSanitizedContent (the shared helper)", () => {
    const el = document.createElement("div");
    setSanitizedContent(el, '<div class="remove"><input type="checkbox" /></div>');
    expect(el.querySelector("div")?.className).toBe("remove");
    expect(el.querySelector("input")?.getAttribute("type")).toBe("checkbox");
  });
});
