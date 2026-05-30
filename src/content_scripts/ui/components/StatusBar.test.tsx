import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { expectDefined } from "../../../../test/helpers";
import { StatusBar } from "./StatusBar";
import type { StatusCell } from "./StatusBar";

describe("StatusBar", () => {
  it("renders one span per cell and updates content reactively", () => {
    const [cells, setCells] = createSignal(["Normal", "", "", ""]);
    const { container } = render(() => <StatusBar cells={cells()} />);
    const spans = container.querySelectorAll("span");
    const firstSpan = spans[0];
    expectDefined(firstSpan);

    expect(spans.length).toBe(4);
    expect(firstSpan.innerHTML).toBe("Normal");

    setCells(["Insert", "", "", ""]);
    expect(firstSpan.innerHTML).toBe("Insert");
  });

  it("pads and divides every non-empty cell except the last", () => {
    const [cells] = createSignal(["a", "b", "", ""]);
    const { container } = render(() => <StatusBar cells={cells()} />);
    const spans = container.querySelectorAll("span");
    const [firstSpan, secondSpan, thirdSpan] = spans;
    expectDefined(firstSpan);
    expectDefined(secondSpan);
    expectDefined(thirdSpan);

    expect(firstSpan.style.padding).toBe("0px 8px");
    // jsdom normalizes the #999 divider color to its rgb() form
    expect(firstSpan.style.borderRight).toBe("1px solid rgb(153, 153, 153)");
    // last non-empty cell carries no trailing divider
    expect(secondSpan.style.borderRight).toBe("");
    // empty cells collapse: no padding, no divider
    expect(thirdSpan.style.padding).toBe("");
    expect(thirdSpan.style.borderRight).toBe("");
  });

  it("injects the search cell's HTML so the find input is reachable", () => {
    const [cells] = createSignal<StatusCell[]>([
      "/",
      { html: '<input id="sk_find" class="sk_theme"/>' },
      "",
      "",
    ]);
    const { container } = render(() => <StatusBar cells={cells()} />);

    expect(container.querySelector("input#sk_find")).not.toBeNull();
  });

  it("sanitizes html cell content before injection", () => {
    const [cells] = createSignal<StatusCell[]>([
      { html: '<img src=x onerror="alert(1)">no script<script>1</script>' },
      "",
      "",
      "",
    ]);
    const { container } = render(() => <StatusBar cells={cells()} />);
    const span = container.querySelector("span");
    expectDefined(span);

    expect(span.querySelector("script")).toBeNull();
    expect(span.querySelector("img")?.hasAttribute("onerror")).toBe(false);
  });
});
