import { describe, expect, it } from "vitest";

import { getScrollableElements, hasScroll } from "./scrollDetection";

describe("hasScroll", () => {
  it("returns false for an element with scrollTop=0 and no effective scroll", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // jsdom elements have no layout, so both scrollTop and the bounding rect are 0.
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
    // jsdom elements have no layout, so both scrollLeft and the bounding rect are 0.
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

  it("returns no elements when the document has no body", () => {
    // Content scripts can run before <body> exists (document_start) and on
    // body-less documents such as XML/SVG.
    const body = document.body;
    body.remove();
    try {
      expect(getScrollableElements()).toEqual([]);
    } finally {
      document.documentElement.appendChild(body);
    }
  });
});
