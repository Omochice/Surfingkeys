import { describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import { Bubble } from "../src/content_scripts/ui/components/Bubble";

describe("Bubble", () => {
    it("injects sanitized HTML and updates reactively", () => {
        const [html, setHtml] = createSignal("<p>tip</p>");
        const { container } = render(() => <Bubble html={html()} />);

        expect(container.querySelector("p")?.textContent).toBe("tip");

        setHtml("<p>changed</p>");
        expect(container.querySelector("p")?.textContent).toBe("changed");
    });

    it("strips scripts from the injected content", () => {
        const { container } = render(() => <Bubble html="<p>ok</p><script>1</script>" />);

        expect(container.querySelector("p")?.textContent).toBe("ok");
        expect(container.querySelector("script")).toBeNull();
    });
});
