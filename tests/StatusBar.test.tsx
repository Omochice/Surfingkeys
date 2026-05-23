import { describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import { StatusBar } from "../src/content_scripts/ui/components/StatusBar";

describe("StatusBar", () => {
    it("shows the status text and updates reactively", () => {
        const [text, setText] = createSignal("Normal");
        const { container } = render(() => <StatusBar text={text()} />);

        expect(container.textContent).toContain("Normal");

        setText("Insert");
        expect(container.textContent).toContain("Insert");
    });

    it("renders nothing when the text is empty", () => {
        const { container } = render(() => <StatusBar text="" />);
        expect(container.querySelector(".sk_status_text")).toBeNull();
    });
});
