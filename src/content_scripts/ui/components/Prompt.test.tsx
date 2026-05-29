import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { Prompt } from "./Prompt";

describe("Prompt", () => {
  it("injects sanitized HTML and renders the separator markup, updating reactively", () => {
    const [html, setHtml] = createSignal("bookmark<span class='separator'>➜</span>");
    const { container } = render(() => <Prompt html={html()} />);

    expect(container.querySelector("span.separator")?.textContent).toBe("➜");
    expect(container.textContent).toContain("bookmark");

    setHtml("tabs<span class='separator'>➜</span>");
    expect(container.textContent).toContain("tabs");
  });

  it("strips scripts from the injected prompt", () => {
    const { container } = render(() => <Prompt html="search<script>1</script>" />);

    expect(container.textContent).toContain("search");
    expect(container.querySelector("script")).toBeNull();
  });
});
