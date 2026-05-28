import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { Keystroke } from "../src/content_scripts/ui/components/Keystroke";

describe("Keystroke", () => {
  it("injects the accumulated keys and updates as the chord grows", () => {
    const [html, setHtml] = createSignal("g");
    const { container } = render(() => (
      <Keystroke
        html={html()}
        rich={false}
      />
    ));
    const root = container.querySelector("div")!;

    expect(root.innerHTML).toBe("g");

    setHtml("gg");
    expect(root.innerHTML).toBe("gg");
  });

  it("toggles the expandRichHints class reactively", () => {
    const [rich, setRich] = createSignal(false);
    const { container } = render(() => (
      <Keystroke
        html=""
        rich={rich()}
      />
    ));
    const root = container.querySelector("div")!;

    expect(root.classList.contains("expandRichHints")).toBe(false);

    setRich(true);
    expect(root.classList.contains("expandRichHints")).toBe(true);
  });

  it("sanitizes the rich-hint HTML before injection", () => {
    const [html] = createSignal('<div class="annotation">scroll</div><script>1</script>');
    const { container } = render(() => (
      <Keystroke
        html={html()}
        rich={true}
      />
    ));
    const root = container.querySelector("div.expandRichHints")!;

    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("div.annotation")).not.toBeNull();
  });
});
