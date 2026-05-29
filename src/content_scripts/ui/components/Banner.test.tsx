import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { Banner } from "../src/content_scripts/ui/components/Banner";

describe("Banner", () => {
  it("shows the message text and updates reactively", () => {
    const [text, setText] = createSignal("Saved");
    const { container } = render(() => <Banner text={text()} />);

    expect(container.textContent).toContain("Saved");

    setText("Copied");
    expect(container.textContent).toContain("Copied");
  });

  it("renders nothing when the message is empty", () => {
    const { container } = render(() => <Banner text="" />);
    expect(container.textContent).toBe("");
  });

  it("shows HTML in the message as literal text", () => {
    const [text] = createSignal("<b>bold</b>");
    const { container } = render(() => <Banner text={text()} />);

    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>bold</b>");
  });
});
