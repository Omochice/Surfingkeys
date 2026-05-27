import { onMount } from "solid-js";
import type { Component } from "solid-js";
import DOMPurify from "dompurify";

export interface ResultItemProps {
    /** Inner HTML of the row (icon, title, url, …); sanitized at injection. */
    html: string;
    /** Extra class on the <li>, e.g. "window" for the window chooser rows. */
    className?: string;
    /** Whether this row is the focused candidate. */
    focused: boolean;
    /** Invoked when the row is clicked. */
    onSelect: () => void;
    /**
     * Favicon URL set on the row's `<img class=icon>` after render. It bypasses
     * sanitization on purpose: Chrome's `chrome-extension://…/_favicon` URLs
     * would otherwise be stripped, exactly as the legacy code set the src
     * imperatively after sanitizing the row content.
     */
    faviconSrc?: string;
}

/**
 * A single omnibar result row. The legacy omnibar built each <li> imperatively
 * with createElementWithContent and toggled a `focused` class on it; here the
 * row's content is injected as sanitized HTML (the highlight markup and the
 * per-handler row shapes stay HTML strings) and the focus state is a prop, so
 * the store/focusedIndex in the omnibar drives it reactively.
 */
export const ResultItem: Component<ResultItemProps> = (props) => {
    let li: HTMLLIElement | undefined;
    onMount(() => {
        if (li && props.faviconSrc) {
            const img = li.querySelector<HTMLImageElement>("img.icon");
            if (img) {
                img.src = props.faviconSrc;
            }
        }
    });
    return (
        <li
            ref={(el) => (li = el)}
            class={props.className}
            classList={{ focused: props.focused }}
            innerHTML={DOMPurify.sanitize(props.html)}
            onClick={() => props.onSelect()}
        />
    );
};
