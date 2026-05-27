import { Show } from "solid-js";
import type { Component } from "solid-js";

export interface BannerProps {
    /** Message text; shown verbatim and hidden while empty. */
    text: string;
}

/**
 * Transient banner shown at the top of the frontend iframe. The legacy code
 * html-encoded the message before injecting it, so it was always displayed as
 * literal text; Solid's text interpolation escapes it the same way. The
 * slide-in position, visibility, and auto-hide timer stay with the controller
 * in frontend.ts.
 */
export const Banner: Component<BannerProps> = (props) => {
    return <Show when={props.text}>{props.text}</Show>;
};
