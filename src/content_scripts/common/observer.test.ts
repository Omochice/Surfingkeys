import { afterEach, describe, expect, it } from "vitest";

import { isNewlyCreated, markSurfingKeysElement } from "./domFlags";
import startScrollNodeObserver from "./observer";
import { dispatchSKEvent } from "./runtime";

const stubNormal = { addScrollableElement: () => {} };

async function flushObserver(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("startScrollNodeObserver — flags newly inserted nodes", () => {
  afterEach(() => {
    dispatchSKEvent("observer", ["turnOff"]);
  });

  it("flags a normal page-inserted element as newly-created", async () => {
    startScrollNodeObserver(stubNormal);
    dispatchSKEvent("observer", ["turnOn"]);

    const div = document.createElement("div");
    document.body.appendChild(div);
    await flushObserver();

    expect(isNewlyCreated(div)).toBe(true);

    div.remove();
  });

  it("skips a SurfingKeys-injected element", async () => {
    startScrollNodeObserver(stubNormal);
    dispatchSKEvent("observer", ["turnOn"]);

    const injected = document.createElement("div");
    markSurfingKeysElement(injected);
    document.body.appendChild(injected);
    await flushObserver();

    expect(isNewlyCreated(injected)).toBe(false);

    injected.remove();
  });
});
