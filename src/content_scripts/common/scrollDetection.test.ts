import { describe, expect, it } from "vitest";

import { getScrollableElements, hasScroll } from "./scrollDetection";

describe("hasScroll", () => {
  it("returns false for an element with scrollTop=0 and no effective scroll", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // jsdom elements have no real layout; scrollTop=0 and getBoundingClientRect returns 0.
    // result < barSize branch: sets scroll to getBoundingClientRect height (0), reads back 0.
    // 0 !== 0 is false → the scroll-suppression counter is not incremented.
    // result (0) >= barSize (16) → false.
    expect(hasScroll(el, "y", 16)).toBe(false);
    document.body.innerHTML = "";
  });

  it("returns true when scrollTop already meets the barSize threshold", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollTop", { get: () => 100, configurable: true });
    document.body.appendChild(el);
    expect(hasScroll(el, "y", 16)).toBe(true);
    document.body.innerHTML = "";
  });

  it("checks horizontal scroll (x direction) — returns false when scrollLeft is 0", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // scrollLeft = 0 < 16 (barSize), getBoundingClientRect().width = 0 → no change → false.
    expect(hasScroll(el, "x", 16)).toBe(false);
    document.body.innerHTML = "";
  });

  it("checks horizontal scroll (x direction) — returns true when scrollLeft meets threshold", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollLeft", { get: () => 50, configurable: true });
    document.body.appendChild(el);
    expect(hasScroll(el, "x", 16)).toBe(true);
    document.body.innerHTML = "";
  });
});

describe("getScrollableElements", () => {
  it("returns no elements on a page without scrollable content", () => {
    document.body.innerHTML = "<div><p>plain text</p></div>";
    expect(getScrollableElements()).toEqual([]);
    document.body.innerHTML = "";
  });
});
