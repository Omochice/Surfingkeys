import { describe, expect, it } from "vitest";

import { deleteNextWord, nextNonWord } from "./insert";

describe("nextNonWord", () => {
  it("moves forward to the first non-word character after the cursor", () => {
    expect(nextNonWord("hello world", 1, 0)).toBe(5);
  });

  it("clamps to the string length when moving forward past the last word", () => {
    expect(nextNonWord("hello world", 1, 5)).toBe(11);
    expect(nextNonWord("foo", 1, 0)).toBe(3);
  });

  it("moves backward to the preceding non-word character", () => {
    expect(nextNonWord("hello world", -1, 11)).toBe(5);
  });

  it("clamps to the start when moving backward past the first word", () => {
    expect(nextNonWord("hello world", -1, 5)).toBe(0);
    expect(nextNonWord("foo", -1, 3)).toBe(0);
  });

  it("treats punctuation as a word boundary", () => {
    expect(nextNonWord("a.b", 1, 0)).toBe(1);
    expect(nextNonWord("a.b", 1, 1)).toBe(3);
  });

  it("stays at the boundary for an empty string", () => {
    expect(nextNonWord("", 1, 0)).toBe(0);
    expect(nextNonWord("", -1, 0)).toBe(0);
  });
});

describe("deleteNextWord", () => {
  it("deletes forward from the cursor to the next word boundary", () => {
    expect(deleteNextWord("hello world", 1, 0)).toEqual([" world", 0]);
    expect(deleteNextWord("foo bar", 1, 0)).toEqual([" bar", 0]);
  });

  it("deletes backward from the cursor to the previous word boundary", () => {
    expect(deleteNextWord("hello world", -1, 11)).toEqual(["hello", 5]);
    expect(deleteNextWord("foo bar", -1, 7)).toEqual(["foo", 3]);
  });

  it("deletes the character under the clamped position when motion stays put", () => {
    expect(deleteNextWord("a", -1, 0)).toEqual(["", 0]);
  });
});
