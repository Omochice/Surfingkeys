import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import { ResultList } from "./ResultList";
import type { ResultListItem } from "./ResultList";

const items: ResultListItem[] = [
  { html: "<div>one</div>" },
  { html: "<div>two</div>" },
  { html: "<div>three</div>", className: "window" },
];

describe("ResultList", () => {
  it("renders a ul of rows and moves focus with focusedIndex", () => {
    const [focused, setFocused] = createSignal(0);
    const { container } = render(() => (
      <ResultList
        items={items}
        focusedIndex={focused()}
        onSelect={() => {}}
      />
    ));
    const li = container.querySelectorAll("ul>li");

    expect(li.length).toBe(3);
    expect(li[0].classList.contains("focused")).toBe(true);
    expect(li[2].classList.contains("window")).toBe(true);

    setFocused(2);
    expect(li[0].classList.contains("focused")).toBe(false);
    expect(li[2].classList.contains("focused")).toBe(true);
  });

  it("reports the clicked row index", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <ResultList
        items={items}
        focusedIndex={-1}
        onSelect={onSelect}
      />
    ));
    fireEvent.click(container.querySelectorAll("ul>li")[1]);

    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("renders nothing when there are no items so the container stays :empty", () => {
    const { container } = render(() => (
      <ResultList
        items={[]}
        focusedIndex={-1}
        onSelect={() => {}}
      />
    ));
    expect(container.querySelector("ul")).toBeNull();
  });
});
