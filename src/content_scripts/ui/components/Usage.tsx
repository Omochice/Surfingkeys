import { For } from "solid-js";
import type { Component } from "solid-js";
import DOMPurify from "dompurify";

export interface UsageProps {
    /**
     * Inner HTML of each non-empty feature group (its feature-name header plus
     * the mapping rows). Each becomes a direct `<div>` child of #sk_usage so the
     * `#sk_usage>div` column layout keeps applying.
     */
    groups: string[];
    /** Localized "More help" link text. */
    moreHelp: string;
}

/**
 * The usage/help panel (#sk_usage), shown for `?`. The legacy code built one big
 * HTML string and set it via setSanitizedContent; the groups are now rendered as
 * separate sanitized rows and the footer link is real markup. The group/row HTML
 * is still assembled by buildUsage (it is locale- and mapping-driven), so only
 * the injection moves to Solid.
 */
export const Usage: Component<UsageProps> = (props) => {
    return (
        <>
            <For each={props.groups}>
                {(group) => <div innerHTML={DOMPurify.sanitize(group)} />}
            </For>
            <p style={{ float: "right", width: "100%", "text-align": "right" }}>
                <a
                    href="https://github.com/brookhong/surfingkeys"
                    target="_blank"
                    style={{ color: "#0095dd" }}
                >
                    {props.moreHelp}
                </a>
            </p>
        </>
    );
};
