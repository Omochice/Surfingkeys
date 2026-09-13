import { afterEach, describe, expect, it, vi } from "vitest";

import { isNewlyCreated, markSurfingKeysElement } from "./domFlags";
import { dispatchSKEvent } from "./events";
import startScrollNodeObserver from "./observer";

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

// startScrollNodeObserver leaves a permanent surfingkeys:observer listener on the document with no
// teardown, and initSKFunctionListener shifts the action off the event's shared detail array, so a
// dispatched event reaches only the earliest-registered listener. Capturing this observer's own
// listener and invoking it directly is what puts the observer under test in charge.
function startObserverWithOwnListener(): (action: string) => void {
  let listener: EventListener | undefined;
  const addSpy = vi.spyOn(document, "addEventListener").mockImplementation((type, l, opts) => {
    if (type === "surfingkeys:observer") {
      listener = l as EventListener;
    }
    return EventTarget.prototype.addEventListener.call(document, type, l, opts);
  });

  startScrollNodeObserver(stubNormal);

  addSpy.mockRestore();
  if (listener == null) {
    throw new Error("startScrollNodeObserver registered no surfingkeys:observer listener");
  }
  const own = listener;
  return (action: string) => own(new CustomEvent("surfingkeys:observer", { detail: [action] }));
}

function startIsolatedObserver(): {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  mutationCallback: MutationCallback;
  fire: (action: string) => void;
  restore: () => void;
} {
  const observe = vi.fn();
  const disconnect = vi.fn();
  let mutationCallback: MutationCallback | undefined;
  const OriginalMO = globalThis.MutationObserver;
  class Tracking {
    constructor(cb: MutationCallback) {
      mutationCallback = cb;
    }
    observe = observe;
    disconnect = disconnect;
    takeRecords = () => [];
  }
  globalThis.MutationObserver = Tracking as unknown as typeof MutationObserver;

  const fire = startObserverWithOwnListener();

  globalThis.MutationObserver = OriginalMO;

  if (mutationCallback == null) {
    throw new Error("the stubbed MutationObserver was never constructed");
  }

  return {
    observe,
    disconnect,
    mutationCallback,
    fire,
    restore: () => {},
  };
}

describe("startScrollNodeObserver — turnOn/turnOff connection guard", () => {
  it("observes the document only once even when turnOn fires twice", () => {
    const obs = startIsolatedObserver();

    obs.fire("turnOn");
    obs.fire("turnOn");

    expect(obs.observe).toHaveBeenCalledTimes(1);
    expect(obs.observe).toHaveBeenCalledWith(document, { childList: true, subtree: true });

    obs.fire("turnOff");
  });

  it("does not disconnect when turnOff fires without a prior turnOn", () => {
    const obs = startIsolatedObserver();

    obs.fire("turnOff");

    expect(obs.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects exactly once when turnOff follows turnOn but a second turnOff is a no-op", () => {
    const obs = startIsolatedObserver();

    obs.fire("turnOn");
    obs.fire("turnOff");
    obs.fire("turnOff");

    expect(obs.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("startScrollNodeObserver — debounce coalescing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the pending updater timer when a second batch of nodes arrives before it fires", () => {
    vi.useFakeTimers();
    const obs = startIsolatedObserver();
    obs.fire("turnOn");

    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    const makeMutation = (): MutationRecord[] => {
      const el = document.createElement("div");
      return [{ addedNodes: [el] as unknown as NodeList } as unknown as MutationRecord];
    };

    // The second batch must arrive before the first batch's 200ms updater fires.
    obs.mutationCallback(makeMutation(), {} as MutationObserver);
    expect(clearSpy).not.toHaveBeenCalled();
    obs.mutationCallback(makeMutation(), {} as MutationObserver);
    expect(clearSpy).toHaveBeenCalledTimes(1);

    clearSpy.mockRestore();
    obs.fire("turnOff");
  });
});
