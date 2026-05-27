import { describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import { Popup } from "../src/content_scripts/ui/components/Popup";

describe("Popup", () => {
    it("injects sanitized HTML and updates reactively", () => {
        const [html, setHtml] = createSignal("<p>hello</p>");
        const { container } = render(() => <Popup html={html()} />);

        expect(container.querySelector("p")?.textContent).toBe("hello");

        setHtml("<p>world</p>");
        expect(container.querySelector("p")?.textContent).toBe("world");
    });

    it("preserves the dialog tab-hint structure the keydown handler queries", () => {
        const [html] = createSignal(
            '<div>Question?</div><div><div class="sk_tab_hint">A</div>' +
                '<span class="sk_tab_group_title">Ok</span>' +
                '<div class="sk_tab_hint">B</div>' +
                '<span class="sk_tab_group_title">Cancel</span></div>',
        );
        const { container } = render(() => <Popup html={html()} />);

        // the frontend keydown handler selects with this exact query
        expect(container.querySelectorAll("div>div.sk_tab_hint").length).toBe(2);
    });

    it("strips scripts from injected content", () => {
        const [html] = createSignal("<p>ok</p><script>alert(1)</script>");
        const { container } = render(() => <Popup html={html()} />);

        expect(container.querySelector("p")?.textContent).toBe("ok");
        expect(container.querySelector("script")).toBeNull();
    });
});
