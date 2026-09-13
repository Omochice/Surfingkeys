import type { Component } from "solid-js";

import { setSafeHtml } from "../setSafeHtml";

export type PopupProps = {
  html: string;
};

/** Popup panel in the frontend iframe, used for showPopup content and the Ok/Cancel dialog. */
export const Popup: Component<PopupProps> = (props) => {
  return <div ref={(el) => setSafeHtml(el, () => props.html)} />;
};
