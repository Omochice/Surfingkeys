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
}

/**
 * A single omnibar result row. The legacy omnibar built each <li> imperatively
 * with createElementWithContent and toggled a `focused` class on it; here the
 * row's content is injected as sanitized HTML (the highlight markup and the
 * per-handler row shapes stay HTML strings) and the focus state is a prop, so
 * the store/focusedIndex in the omnibar drives it reactively.
 */
export const ResultItem: Component<ResultItemProps> = (props) => {
    return (
        <li
            class={props.className}
            classList={{ focused: props.focused }}
            innerHTML={DOMPurify.sanitize(props.html)}
            onClick={() => props.onSelect()}
        />
    );
};
