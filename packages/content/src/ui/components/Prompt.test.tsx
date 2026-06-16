import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import { Prompt } from "./Prompt";
import type { PromptValue } from "./Prompt";

describe("Prompt", () => {
  it("renders a text label followed by the styled separator, updating reactively", () => {
    const [value, setValue] = createSignal<PromptValue>("bookmark");
    const { container } = render(() => <Prompt value={value()} />);

    expect(container.querySelector("span.separator")?.textContent).toBe("➤");
    expect(container.textContent).toContain("bookmark");

    setValue("tabs");
    expect(container.textContent).toContain("tabs");
  });

  it("renders the label as text rather than markup", () => {
    const { container } = render(() => <Prompt value="<script>1</script>" />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>1</script>");
  });

  it("sanitizes html prompt content (the search-engine icon)", () => {
    const { container } = render(() => (
      <Prompt value={{ html: '<img src=x onerror="alert(1)">no script<script>1</script>' }} />
    ));

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    // the icon path carries no separator
    expect(container.querySelector("span.separator")).toBeNull();
  });
});
