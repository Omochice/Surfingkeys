import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { Keystroke } from "./Keystroke";

describe("Keystroke", () => {
  it("renders the accumulated keys as text and updates as the chord grows", () => {
    const [text, setText] = createSignal("g");
    const { container } = render(() => (
      <Keystroke
        text={text()}
        html=""
        rich={false}
      />
    ));
    const root = container.querySelector("div")!;

    expect(root.innerHTML).toBe("g");

    setText("gg");
    expect(root.innerHTML).toBe("gg");
  });

  it("escapes markup in the plain chord keys instead of injecting it", () => {
    const { container } = render(() => (
      <Keystroke
        text="<C-a>"
        html=""
        rich={false}
      />
    ));
    const root = container.querySelector("div")!;

    expect(root.querySelector("span")).toBeNull();
    expect(root.textContent).toBe("<C-a>");
  });

  it("toggles the expandRichHints class reactively", () => {
    const [rich, setRich] = createSignal(false);
    const { container } = render(() => (
      <Keystroke
        text=""
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
        text=""
        html={html()}
        rich={true}
      />
    ));
    const root = container.querySelector("div.expandRichHints")!;

    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("div.annotation")).not.toBeNull();
  });
});
