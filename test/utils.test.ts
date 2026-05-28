import { describe, expect, it } from "vitest";

import { getColor, parseAnnotation } from "../src/content_scripts/common/utils";

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
