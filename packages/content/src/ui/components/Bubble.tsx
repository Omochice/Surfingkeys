import type { Component } from "solid-js";

import { setSafeHtml } from "../setSafeHtml";

export type BubbleProps = {
  html: string;
};

/** Content of the mouse-selection bubble (#sk_bubble's .sk_bubble_content). */
export const Bubble: Component<BubbleProps> = (props) => {
  return <div ref={(el) => setSafeHtml(el, () => props.html)} />;
};
