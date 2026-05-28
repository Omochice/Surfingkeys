import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render } from "@solidjs/testing-library";
import { ResultItem } from "../src/content_scripts/ui/components/ResultItem";

describe("ResultItem", () => {
    it("injects the row HTML and reflects the focused prop reactively", () => {
        const [focused, setFocused] = createSignal(false);
        const { container } = render(() => (
            <ResultItem
                html='<div class="title">Example</div><div class="url">https://example.com</div>'
                focused={focused()}
                onSelect={() => {}}
            />
        ));
        const li = container.querySelector("li")!;

        expect(li.querySelector("div.title")?.textContent).toBe("Example");
        expect(li.classList.contains("focused")).toBe(false);

        setFocused(true);
        expect(li.classList.contains("focused")).toBe(true);
    });

    it("applies the extra className", () => {
        const { container } = render(() => (
            <ResultItem
                html="<div>w</div>"
                className="window"
                focused={false}
                onSelect={() => {}}
            />
        ));
        expect(container.querySelector("li")?.classList.contains("window")).toBe(true);
    });

    it("calls onSelect when clicked", () => {
        const onSelect = vi.fn();
        const { container } = render(() => (
            <ResultItem html="<div>x</div>" focused={false} onSelect={onSelect} />
        ));
        fireEvent.click(container.querySelector("li")!);

        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("sets the favicon src on the row's img after render", () => {
        const { container } = render(() => (
            <ResultItem
                html='<img class="icon"/><div class="title">tab</div>'
                faviconSrc="chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fexample.com"
                focused={false}
                onSelect={() => {}}
            />
        ));
        const img = container.querySelector<HTMLImageElement>("img.icon")!;

        expect(img.getAttribute("src")).toBe(
            "chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fexample.com",
        );
    });

    it("sanitizes the injected HTML", () => {
        const { container } = render(() => (
            <ResultItem
                html="<div>ok</div><script>1</script>"
                focused={false}
                onSelect={() => {}}
            />
        ));
        expect(container.querySelector("script")).toBeNull();
        expect(container.querySelector("li")?.textContent).toBe("ok");
    });
});
