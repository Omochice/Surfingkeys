import { onMount } from "solid-js";
import type { Component } from "solid-js";

import { setSafeHtml } from "../setSafeHtml";

export type ResultItemProps = {
  /** Inner HTML of the row (icon, title, url, …); sanitized at injection. */
  html: string;
  /** Extra class on the <li>, e.g. "window" for the window chooser rows. */
  className?: string | undefined;
  focused: boolean;
  onSelect: () => void;
  /**
   * Favicon URL set on the row's `<img class=icon>` after render, bypassing sanitization on
   * purpose: Chrome's `chrome-extension://…/_favicon` URLs would otherwise be stripped.
   */
  faviconSrc?: string | undefined;
};

/** A single omnibar result row. */
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
      ref={(el) => {
        li = el;
        setSafeHtml(el, () => props.html);
      }}
      class={props.className}
      classList={{ focused: props.focused }}
      onClick={() => props.onSelect()}
    />
  );
};
