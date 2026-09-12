import { describe, expect, it } from "vitest";

import { toTransferable } from "./relay";

describe("toTransferable", () => {
  it("flattens an Error to its name, message and stack", () => {
    const error = new TypeError("boom");
    expect(toTransferable(error)).toEqual({
      name: "TypeError",
      message: "boom",
      stack: error.stack,
    });
  });

  it("passes a non-error argument through untouched", () => {
    const arg = { id: 1 };
    expect(toTransferable(arg)).toBe(arg);
    expect(toTransferable("text")).toBe("text");
  });
});
