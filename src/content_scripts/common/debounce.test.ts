import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not invoke the function synchronously on call", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced();

    expect(fn).not.toHaveBeenCalled();
  });
});
