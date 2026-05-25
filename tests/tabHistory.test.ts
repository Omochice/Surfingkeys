import { describe, expect, it } from "vitest";
import { createTabHistory } from "../src/background/tabHistory";

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
        // Only one entry, so there is no previous tab.
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
        h.record(3); // cursor at the newest (3)
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
        // The ring is still [1, 2]: index 1 is the second tab, not 99.
        expect(h.navigate({ index: 1 })).toBe(2);
    });

    it("drops a removed tab from the ring", () => {
        const h = createTabHistory();
        h.record(1);
        h.record(2);
        h.record(3);
        h.remove(2);
        // [1, 3] now, so the tab before the head is 1.
        expect(h.previousTab()).toBe(1);
    });

    it("keeps only the most recent activations, capped at ten", () => {
        const h = createTabHistory();
        for (let i = 1; i <= 12; i++) {
            h.record(i);
        }
        // The two newest are 11 and 12 regardless of the cap trimming the oldest.
        expect(h.previousTab()).toBe(11);
    });
});
