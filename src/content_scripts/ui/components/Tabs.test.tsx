import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

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
    expect(sk[1]!.classList.contains("active")).toBe(true);
    expect(sk[0]!.classList.contains("active")).toBe(false);
    expect(sk[2]!.classList.contains("active")).toBe(false);
  });

  it("assigns hint labels and link expandos to the non-active tabs only", () => {
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
    const hints = container.querySelectorAll<HTMLElement & { label?: string; link?: unknown }>(
      "div>div.sk_tab_hint",
    );

    expect(hints.length).toBe(2);
    expect(hints[0]!.textContent).toBe("A");
    expect(hints[0]!.label).toBe("A");
    expect(hints[0]!.link).toEqual({ id: 1, windowId: 7 });
    expect(hints[1]!.label).toBe("B");
    expect(hints[1]!.link).toEqual({ id: 3, windowId: 7 });
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
    const title = container.querySelectorAll("div.sk_tab_title")[1]!;

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

    expect(sk[0]!.style.width).toBe("120px");
    expect((container.querySelector("div.sk_tab_title") as HTMLElement).style.width).toBe("96px");
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

    expect(container.querySelectorAll("div.tab_rocket").length).toBe(3);
    expect(sk[0]!.style.width).toBe("");
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
    expect(calls[0]!.tab).toBe(tabs[0]);
    expect(calls[0]!.img).toBeInstanceOf(HTMLImageElement);
  });
});
