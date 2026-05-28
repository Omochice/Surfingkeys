import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import { SearchInput } from "../src/content_scripts/ui/components/SearchInput";

const noop = () => {};

const composedInput = (target: HTMLInputElement, value: string, isComposing: boolean) => {
    target.value = value;
    target.dispatchEvent(new InputEvent("input", { isComposing, bubbles: true }));
};

const keydown = (target: HTMLInputElement, key: string, isComposing: boolean) => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing, bubbles: true }));
};

describe("SearchInput", () => {
    it("shows the bound value prop and updates reactively", () => {
        const [value, setValue] = createSignal("github");
        const { container } = render(() => (
            <SearchInput
                value={value()}
                visible={true}
                placeholder=""
                onInput={noop}
                onKeyDown={noop}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        expect(input.value).toBe("github");

        setValue("gitlab");
        expect(input.value).toBe("gitlab");
    });

    it("emits onInput with the current text for non-composing input", () => {
        const onInput = vi.fn();
        const { container } = render(() => (
            <SearchInput
                value=""
                visible={true}
                placeholder=""
                onInput={onInput}
                onKeyDown={noop}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        composedInput(input, "hello", false);

        expect(onInput).toHaveBeenCalledWith("hello");
    });

    it("suppresses onInput while event.isComposing is true", () => {
        const onInput = vi.fn();
        const { container } = render(() => (
            <SearchInput
                value=""
                visible={true}
                placeholder=""
                onInput={onInput}
                onKeyDown={noop}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        composedInput(input, "に", true);
        composedInput(input, "にほ", true);

        expect(onInput).not.toHaveBeenCalled();
    });

    it("emits onInput once with the final value on compositionend", () => {
        const onInput = vi.fn();
        const { container } = render(() => (
            <SearchInput
                value=""
                visible={true}
                placeholder=""
                onInput={onInput}
                onKeyDown={noop}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        composedInput(input, "にほ", true);
        input.value = "日本";
        input.dispatchEvent(
            new CompositionEvent("compositionend", { data: "日本", bubbles: true }),
        );

        expect(onInput).toHaveBeenCalledTimes(1);
        expect(onInput).toHaveBeenCalledWith("日本");
    });

    it("emits onKeyDown for non-composing keystrokes", () => {
        const onKeyDown = vi.fn();
        const { container } = render(() => (
            <SearchInput
                value=""
                visible={true}
                placeholder=""
                onInput={noop}
                onKeyDown={onKeyDown}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        keydown(input, "Enter", false);

        expect(onKeyDown).toHaveBeenCalledTimes(1);
        expect(onKeyDown.mock.calls[0][0].key).toBe("Enter");
    });

    it("suppresses onKeyDown while event.isComposing is true", () => {
        const onKeyDown = vi.fn();
        const { container } = render(() => (
            <SearchInput
                value=""
                visible={true}
                placeholder=""
                onInput={noop}
                onKeyDown={onKeyDown}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        keydown(input, "Enter", true);

        expect(onKeyDown).not.toHaveBeenCalled();
    });

    it("reflects the placeholder prop", () => {
        const [placeholder, setPlaceholder] = createSignal("type here");
        const { container } = render(() => (
            <SearchInput
                value=""
                visible={true}
                placeholder={placeholder()}
                onInput={noop}
                onKeyDown={noop}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        expect(input.placeholder).toBe("type here");

        setPlaceholder("");
        expect(input.placeholder).toBe("");
    });

    it("hides the element when visible is false", () => {
        const [visible, setVisible] = createSignal(true);
        const { container } = render(() => (
            <SearchInput
                value=""
                visible={visible()}
                placeholder=""
                onInput={noop}
                onKeyDown={noop}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        expect(input.style.display).not.toBe("none");

        setVisible(false);
        expect(input.style.display).toBe("none");
    });

    it("forwards the underlying input element via ref", () => {
        let captured: HTMLInputElement | undefined;
        const { container } = render(() => (
            <SearchInput
                value=""
                visible={true}
                placeholder=""
                onInput={noop}
                onKeyDown={noop}
                ref={(el) => (captured = el)}
            />
        ));
        const input = container.querySelector("input") as HTMLInputElement;

        expect(captured).toBe(input);
    });
});
