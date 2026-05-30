import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../test/helpers";
import { _fixTo, _roundBase, createTabs } from "./tabs";

type AnyChrome = { tabs?: any; windows?: any; commands?: any };
const g = globalThis as unknown as { chrome: AnyChrome };

afterEach(() => {
  delete g.chrome.tabs;
  delete g.chrome.windows;
  delete g.chrome.commands;
});

describe("_fixTo", () => {
  it("clamps a negative target up to 0", () => {
    expect(_fixTo(-3, 10)).toBe(0);
  });

  it("leaves an in-range target untouched", () => {
    expect(_fixTo(4, 10)).toBe(4);
  });

  it("clamps an over-range target down to length", () => {
    expect(_fixTo(10, 10)).toBe(10);
    expect(_fixTo(15, 10)).toBe(10);
  });
});

describe("_roundBase", () => {
  it("leaves the base when the repeat count fits ahead", () => {
    expect(_roundBase(2, 3, 10)).toBe(2);
  });

  it("rounds the base back when the repeat count would overrun the length", () => {
    expect(_roundBase(8, 5, 10)).toBe(5);
    expect(_roundBase(9, 3, 10)).toBe(7);
  });
});

describe("createTabs — tab navigation index math", () => {
  /** Builds a tab unit over a chrome stub whose query returns `tabs`. */
  function tabUnitOver(tabs: any[]) {
    const noopListener = { addListener: () => {} };
    const update = vi.fn();
    g.chrome.tabs = {
      onRemoved: noopListener,
      onUpdated: noopListener,
      onCreated: noopListener,
      onMoved: noopListener,
      onActivated: noopListener,
      onDetached: noopListener,
      onAttached: noopListener,
      query: (_q: any, cb: (t: any[]) => void) => cb(tabs),
      update,
    };
    g.chrome.windows = { onFocusChanged: noopListener };
    g.chrome.commands = { onCommand: noopListener };
    const unit = createTabs({
      _response: vi.fn(),
      conf: {},
      browser: { _setNewTabUrl: () => "about:newtab" },
      handlers: {},
    });
    return { unit, update };
  }

  it("previousTab from the first tab wraps to the last", () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const previousTab = unit.handlers["previousTab"];
    expectDefined(previousTab);
    previousTab({ repeats: 1 }, { tab: { index: 0, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(3, { active: true });
  });

  it("nextTab from the last tab wraps to the first", () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const nextTab = unit.handlers["nextTab"];
    expectDefined(nextTab);
    nextTab({ repeats: 1 }, { tab: { index: 2, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(1, { active: true });
  });

  it("nextTab steps forward without wrapping inside the range", () => {
    const { unit, update } = tabUnitOver([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const nextTab = unit.handlers["nextTab"];
    expectDefined(nextTab);
    nextTab({ repeats: 1 }, { tab: { index: 0, windowId: 5 } }, vi.fn());
    expect(update).toHaveBeenCalledWith(2, { active: true });
  });
});
