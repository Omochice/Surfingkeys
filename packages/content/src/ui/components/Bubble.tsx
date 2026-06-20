import type { Component } from "solid-js";

import { setSafeHtml } from "../setSafeHtml";

export type BubbleProps = {
  /** Raw HTML shown in the bubble; sanitized at injection. */
  html: string;
};

/**
 * Content of the mouse-selection bubble (#sk_bubble's .sk_bubble_content). The legacy code set the
 * content via setSanitizedContent; only that injection moves to Solid. The bubble's positioning,
 * arrow direction, size clamping, and scroll indicators are measurement-driven and stay in the
 * controller.
 */
export const Bubble: Component<BubbleProps> = (props) => {
  return <div ref={(el) => setSafeHtml(el, () => props.html)} />;
};
