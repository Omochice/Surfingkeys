import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import { Usage } from "../src/content_scripts/ui/components/Usage";

const groups = [
  '<div class="feature_name"><span>Tabs</span></div>' +
    '<div><span class="kbd-span"><kbd>t</kbd></span><span class="annotation">open a tab</span></div>',
  '<div class="feature_name"><span>Scroll</span></div>' +
    '<div><span class="kbd-span"><kbd>j</kbd></span><span class="annotation">scroll down</span></div>',
];

describe("Usage", () => {
  it("renders one div per group plus the more-help link", () => {
    const { container } = render(() => (
      <Usage
        groups={groups}
        moreHelp="More help"
      />
    ));

    expect(container.querySelectorAll("div.feature_name").length).toBe(2);
    expect(container.querySelector("kbd")?.textContent).toBe("t");
    expect(container.querySelector("span.annotation")?.textContent).toBe("open a tab");

    const link = container.querySelector("a")!;
    expect(link.textContent).toBe("More help");
    expect(link.getAttribute("href")).toBe("https://github.com/brookhong/surfingkeys");
  });

  it("sanitizes each group's HTML", () => {
    const { container } = render(() => (
      <Usage
        groups={["<div>ok</div><script>1</script>"]}
        moreHelp="More help"
      />
    ));

    expect(container.querySelector("script")).toBeNull();
  });
});
