import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { ResultPage } from "./ResultPage";

describe("ResultPage", () => {
  it("shows the pagination text and updates reactively", () => {
    const [text, setText] = createSignal("1 - 10 / 50");
    const { container } = render(() => <ResultPage text={text()} />);

    expect(container.textContent).toContain("1 - 10 / 50");

    setText("11 - 20 / 50");
    expect(container.textContent).toContain("11 - 20 / 50");
  });

  it("renders nothing when the text is empty", () => {
    const { container } = render(() => <ResultPage text="" />);
    expect(container.textContent).toBe("");
  });

  it("shows HTML in the text as literal text", () => {
    const { container } = render(() => <ResultPage text="<b>1</b> / 2" />);

    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>1</b> / 2");
  });
});
