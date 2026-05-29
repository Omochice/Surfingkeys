import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  it("renders one span per cell and updates content reactively", () => {
    const [cells, setCells] = createSignal(["Normal", "", "", ""]);
    const { container } = render(() => <StatusBar cells={cells()} />);
    const spans = container.querySelectorAll("span");

    expect(spans.length).toBe(4);
    expect(spans[0]!.innerHTML).toBe("Normal");

    setCells(["Insert", "", "", ""]);
    expect(spans[0]!.innerHTML).toBe("Insert");
  });

  it("pads and divides every non-empty cell except the last", () => {
    const [cells] = createSignal(["a", "b", "", ""]);
    const { container } = render(() => <StatusBar cells={cells()} />);
    const spans = container.querySelectorAll("span");

    expect((spans[0]! as HTMLElement).style.padding).toBe("0px 8px");
    // jsdom normalizes the #999 divider color to its rgb() form
    expect((spans[0]! as HTMLElement).style.borderRight).toBe("1px solid rgb(153, 153, 153)");
    // last non-empty cell carries no trailing divider
    expect((spans[1]! as HTMLElement).style.borderRight).toBe("");
    // empty cells collapse: no padding, no divider
    expect((spans[2]! as HTMLElement).style.padding).toBe("");
    expect((spans[2]! as HTMLElement).style.borderRight).toBe("");
  });

  it("injects the search cell's HTML so the find input is reachable", () => {
    const [cells] = createSignal(["/", '<input id="sk_find" class="sk_theme"/>', "", ""]);
    const { container } = render(() => <StatusBar cells={cells()} />);

    expect(container.querySelector("input#sk_find")).not.toBeNull();
  });

  it("sanitizes cell HTML before injection", () => {
    const [cells] = createSignal([
      '<img src=x onerror="alert(1)">no script<script>1</script>',
      "",
      "",
      "",
    ]);
    const { container } = render(() => <StatusBar cells={cells()} />);
    const span = container.querySelector("span")!;

    expect(span.querySelector("script")).toBeNull();
    expect(span.querySelector("img")?.hasAttribute("onerror")).toBe(false);
  });
});
