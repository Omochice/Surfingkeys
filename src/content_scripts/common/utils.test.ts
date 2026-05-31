import { describe, expect, it } from "vitest";

import { getColor, hintLabel, parseAnnotation, refreshHints } from "./utils";

describe("getColor", () => {
  it("returns a CSS color string for valid indices", () => {
    expect(typeof getColor(0)).toBe("string");
    expect(getColor(0).startsWith("#")).toBe(true);
  });

  it("returns the same value for the same index", () => {
    expect(getColor(3)).toBe(getColor(3));
  });
});

describe("parseAnnotation", () => {
  it("splits a leading #N from a string annotation into feature_group", () => {
    const result = parseAnnotation({ annotation: "#5Quit chrome" });
    expect(result.feature_group).toBe(5);
    expect(result.annotation).toEqual(["Quit chrome"]);
  });

  it("returns an empty annotation when only the #N marker is present", () => {
    const result = parseAnnotation({ annotation: "#5" });
    expect(result.feature_group).toBe(5);
    expect(result.annotation).toBe("");
  });

  it("leaves a string annotation without #N wrapped in an array", () => {
    const result = parseAnnotation({ annotation: "Plain text" });
    expect(result.feature_group).toBeUndefined();
    expect(result.annotation).toEqual(["Plain text"]);
  });

  it("returns the array form when given an array annotation with a #N marker", () => {
    const result = parseAnnotation({
      annotation: ["#6Search selected with {0}", "Google"],
    });
    expect(result.feature_group).toBe(6);
    expect(result.annotation).toEqual(["Search selected with {0}", "Google"]);
  });
});

// Characterization tests pinning refreshHints before the HintElement WeakMap
// refactor. They record how the function reads `label`/`link` off the elements
// it is handed and how it mutates them; the expected values are whatever the
// current code produces, not a hand-authored spec.
function makeHint(label: string, link: unknown) {
  const el = document.createElement("div");
  hintLabel.set(el, label);
  return Object.assign(el, { link });
}

describe("refreshHints (characterization)", () => {
  it("returns the matched element's link with zero candidates on exact match", () => {
    const a = makeHint("ab", "LINK_A");
    const b = makeHint("cd", "LINK_B");
    expect(refreshHints([a, b], "ab")).toEqual({ candidates: 0, matched: "LINK_A" });
  });

  it("counts a prefix match, shows it, and highlights the typed prefix in innerHTML", () => {
    const a = makeHint("abc", "LINK_A");
    const result = refreshHints([a], "ab");
    expect(result).toEqual({ candidates: 1 });
    expect(a.style.opacity).toBe("1");
    expect(a.innerHTML).toBe('<span style="opacity: 0.2;">ab</span>c');
  });

  it("hides a non-matching hint via opacity 0", () => {
    const a = makeHint("xyz", "LINK_A");
    refreshHints([a], "ab");
    expect(a.style.opacity).toBe("0");
  });

  it("returns the single hint's link when no keys are pressed", () => {
    const a = makeHint("ab", "LINK_A");
    expect(refreshHints([a], "")).toEqual({ candidates: 0, matched: "LINK_A" });
  });

  it("shows every hint and restores its label when no keys are pressed", () => {
    const a = makeHint("ab", "LINK_A");
    const b = makeHint("cd", "LINK_B");
    const result = refreshHints([a, b], "");
    expect(result).toEqual({ candidates: 2 });
    expect(a.style.opacity).toBe("1");
    expect(a.innerHTML).toBe("ab");
  });
});
