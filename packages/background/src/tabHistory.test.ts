import { describe, expect, it } from "vitest";

import { createTabHistory } from "./tabHistory";

describe("createTabHistory", () => {
  it("records distinct activations and reports the previous tab", () => {
    const h = createTabHistory();
    h.record(1);
    h.record(2);
    h.record(3);
    expect(h.previousTab()).toBe(2);
  });

  it("ignores a re-activation of the tab already at the head", () => {
    const h = createTabHistory();
    h.record(1);
    h.record(1);
    expect(h.previousTab()).toBeUndefined();
  });

  it("has no previous tab until at least two distinct tabs are seen", () => {
    const h = createTabHistory();
    expect(h.previousTab()).toBeUndefined();
    h.record(7);
    expect(h.previousTab()).toBeUndefined();
  });

  it("navigate by absolute index wraps, including negative indices", () => {
    const h = createTabHistory();
    h.record(1);
    h.record(2);
    h.record(3);
    expect(h.navigate({ index: 0 })).toBe(1);
    expect(h.navigate({ index: -1 })).toBe(3);
    expect(h.navigate({ index: 1 })).toBe(2);
  });

  it("navigate steps backward and forward, clamped to the ends", () => {
    const h = createTabHistory();
    h.record(1);
    h.record(2);
    h.record(3);
    expect(h.navigate({ backward: true })).toBe(2);
    expect(h.navigate({ backward: true })).toBe(1);
    expect(h.navigate({ backward: true })).toBe(1); // clamped at the oldest
    expect(h.navigate({ backward: false })).toBe(2);
  });

  it("returns undefined when navigating an empty ring", () => {
    const h = createTabHistory();
    expect(h.navigate({ backward: true })).toBeUndefined();
    expect(h.navigate({ index: 0 })).toBeUndefined();
  });

  it("skips the single activation its own navigation triggers", () => {
    const h = createTabHistory();
    h.record(1);
    h.record(2);
    // Navigating sets the programmatic-switch flag; the onActivated event it
    // causes must not rewrite the ring.
    expect(h.navigate({ index: 0 })).toBe(1);
    h.record(99); // the programmatic activation — must be ignored
    expect(h.navigate({ index: 1 })).toBe(2);
  });

  it("drops a removed tab from the ring", () => {
    const h = createTabHistory();
    h.record(1);
    h.record(2);
    h.record(3);
    h.remove(2);
    expect(h.previousTab()).toBe(1);
  });

  it("keeps only the most recent activations, capped at ten", () => {
    const h = createTabHistory();
    for (let i = 1; i <= 12; i++) {
      h.record(i);
    }
    expect(h.previousTab()).toBe(11);
  });
});
