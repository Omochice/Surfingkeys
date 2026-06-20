import type { Component } from "solid-js";

import { setSafeHtml } from "../setSafeHtml";

export type PopupProps = {
  /** Raw HTML content shown in the popup; sanitized at the injection point. */
  html: string;
};

/**
 * Popup panel in the frontend iframe, used for showPopup content and the Ok/Cancel dialog. The
 * legacy code set #sk_popup's innerHTML directly; the component injects the sanitized HTML instead.
 * Visibility is still driven by the controller's showElement/display machinery, and the dialog's
 * tab-hint nodes (the .link/.label expandos read by the frontend keydown handler) are set on the
 * rendered nodes after the synchronous render, exactly as before.
 */
export const Popup: Component<PopupProps> = (props) => {
  return <div ref={(el) => setSafeHtml(el, () => props.html)} />;
};
