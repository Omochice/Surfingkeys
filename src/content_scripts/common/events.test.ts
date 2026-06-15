import { describe, expect, it } from "vitest";

import { dispatchSKEvent } from "./events";

describe("dispatchSKEvent", () => {
  it("dispatches the namespaced CustomEvent on document by default", () => {
    const received: CustomEvent[] = [];
    const handler = (e: Event) => received.push(e as CustomEvent);
    document.addEventListener("surfingkeys:front", handler);
    // No target argument → the default `document` parameter is used.
    dispatchSKEvent("front", ["x", 1]);
    document.removeEventListener("surfingkeys:front", handler);

    expect(received).toHaveLength(1);
    expect(received[0]!.detail).toEqual(["x", 1]);
  });

  it("dispatches on an explicit target when one is provided", () => {
    const el = document.createElement("div");
    const received: CustomEvent[] = [];
    el.addEventListener("surfingkeys:user", (e) => received.push(e as CustomEvent));
    dispatchSKEvent("user", { a: 1 }, el);

    expect(received).toHaveLength(1);
    expect(received[0]!.detail).toEqual({ a: 1 });
  });
});
