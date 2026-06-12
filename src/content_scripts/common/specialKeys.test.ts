import { afterEach, describe, expect, it } from "vitest";

import KeyboardUtils from "./keyboardUtils";
import { isSpecialKeyOf, specialKeys } from "./specialKeys";

describe("isSpecialKeyOf", () => {
  it("matches a registered special key", () => {
    expect(isSpecialKeyOf("<Esc>", KeyboardUtils.encodeKeystroke("<Esc>"))).toBe(true);
  });

  it("returns false for an unregistered special key bucket", () => {
    expect(isSpecialKeyOf("<DoesNotExist>", KeyboardUtils.encodeKeystroke("<Esc>"))).toBe(false);
  });

  it("returns false when the key does not belong to the special-key set", () => {
    expect(isSpecialKeyOf("<Esc>", KeyboardUtils.encodeKeystroke("a"))).toBe(false);
  });
});

describe("specialKeys registry", () => {
  afterEach(() => {
    specialKeys["<Esc>"] = ["<Esc>"];
  });

  it("exposes a mutable singleton so callers can register aliases at runtime", () => {
    specialKeys["<Esc>"]?.push("<Ctrl-[>");

    expect(isSpecialKeyOf("<Esc>", KeyboardUtils.encodeKeystroke("<Ctrl-[>"))).toBe(true);
  });
});
