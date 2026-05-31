import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import { expectDefined } from "../../../../test/helpers";
import { hintLabel, hintLink, refreshHints } from "../../common/utils";
import { Tabs } from "./Tabs";
import type { TabsTab } from "./Tabs";

const tabs: TabsTab[] = [
  { id: 1, windowId: 7, title: "First", active: false, url: "https://a.example" },
  { id: 2, windowId: 7, title: "Active <b>tab</b>", active: true, url: "https://b.example" },
  { id: 3, windowId: 7, title: "Third", active: false, url: "https://c.example" },
];

describe("Tabs", () => {
  it("renders one tab per entry and flags the active one", () => {
    const { container } = render(() => (
      <Tabs
        tabs={tabs}
        hintLabels={["A", "B"]}
        vertical={false}
        unitWidth={120}
        attachFavicon={() => {}}
      />
    ));
    const sk = container.querySelectorAll("div.sk_tab");
    expect(sk.length).toBe(3);
    const [firstTab, secondTab, thirdTab] = sk;
    expectDefined(firstTab);
    expectDefined(secondTab);
    expectDefined(thirdTab);

    expect(secondTab.classList.contains("active")).toBe(true);
    expect(firstTab.classList.contains("active")).toBe(false);
    expect(thirdTab.classList.contains("active")).toBe(false);
  });

  it("stores hint labels and links in the WeakMaps for the non-active tabs only", () => {
    const { container } = render(() => (
      <Tabs
        tabs={tabs}
        hintLabels={["A", "B"]}
        vertical={false}
        unitWidth={120}
        attachFavicon={() => {}}
      />
    ));
    // the frontend keydown handler selects with this exact query
    const hints = container.querySelectorAll<HTMLElement>("div>div.sk_tab_hint");
    expect(hints.length).toBe(2);
    const [firstHint, secondHint] = hints;
    expectDefined(firstHint);
    expectDefined(secondHint);

    expect(firstHint.textContent).toBe("A");
    expect(hintLabel.get(firstHint)).toBe("A");
    expect(hintLink.get(firstHint)).toEqual({ id: 1, windowId: 7 });
    expect(hintLabel.get(secondHint)).toBe("B");
    expect(hintLink.get(secondHint)).toEqual({ id: 3, windowId: 7 });
    // the active tab carries no hint
    expect(container.querySelectorAll("div.sk_tab.active div.sk_tab_hint").length).toBe(0);
  });

  it("renders the title as escaped text", () => {
    const { container } = render(() => (
      <Tabs
        tabs={tabs}
        hintLabels={["A", "B"]}
        vertical={false}
        unitWidth={120}
        attachFavicon={() => {}}
      />
    ));
    const title = container.querySelectorAll("div.sk_tab_title")[1];
    expectDefined(title);

    expect(title.querySelector("b")).toBeNull();
    expect(title.textContent).toBe("Active <b>tab</b>");
  });

  it("sets per-tab widths and no rocket in horizontal mode", () => {
    const { container } = render(() => (
      <Tabs
        tabs={tabs}
        hintLabels={["A", "B"]}
        vertical={false}
        unitWidth={120}
        attachFavicon={() => {}}
      />
    ));
    const sk = container.querySelectorAll<HTMLElement>("div.sk_tab");
    const firstSk = sk[0];
    expectDefined(firstSk);
    const firstTitle = container.querySelector<HTMLElement>("div.sk_tab_title");
    expectDefined(firstTitle);

    expect(firstSk.style.width).toBe("120px");
    expect(firstTitle.style.width).toBe("96px");
    expect(container.querySelector("div.tab_rocket")).toBeNull();
  });

  it("renders a rocket and omits widths in vertical mode", () => {
    const { container } = render(() => (
      <Tabs
        tabs={tabs}
        hintLabels={["A", "B"]}
        vertical={true}
        unitWidth={120}
        attachFavicon={() => {}}
      />
    ));
    const sk = container.querySelectorAll<HTMLElement>("div.sk_tab");
    const firstSk = sk[0];
    expectDefined(firstSk);

    expect(container.querySelectorAll("div.tab_rocket").length).toBe(3);
    expect(firstSk.style.width).toBe("");
  });

  it("attaches the favicon to each tab's img", () => {
    const calls: { tab: TabsTab; img: HTMLImageElement }[] = [];
    render(() => (
      <Tabs
        tabs={tabs}
        hintLabels={["A", "B"]}
        vertical={false}
        unitWidth={120}
        attachFavicon={(tab, img) => calls.push({ tab, img })}
      />
    ));
    expect(calls.length).toBe(3);
    const firstCall = calls[0];
    expectDefined(firstCall);

    expect(firstCall.tab).toBe(tabs[0]);
    expect(firstCall.img).toBeInstanceOf(HTMLImageElement);
  });

  it("resolves a tab hint through refreshHints (regression: label/link were expandos, not WeakMaps)", () => {
    const { container } = render(() => (
      <Tabs
        tabs={tabs}
        hintLabels={["A", "B"]}
        vertical={false}
        unitWidth={120}
        attachFavicon={() => {}}
      />
    ));
    const firstHint = container.querySelector<HTMLElement>("div>div.sk_tab_hint");
    expectDefined(firstHint);

    // refreshHints reads label/link via the hintLabel/hintLink WeakMaps; pressing
    // the hint's label must resolve to the first non-active tab's link.
    expect(refreshHints([firstHint], "A")).toEqual({
      candidates: 0,
      matched: { id: 1, windowId: 7 },
    });
  });
});
