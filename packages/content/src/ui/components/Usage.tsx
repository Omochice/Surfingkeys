import { For } from "solid-js";
import type { Component } from "solid-js";

import { setSafeHtml } from "../setSafeHtml";

export type UsageProps = {
  /**
   * Inner HTML of each non-empty feature group. Each becomes a direct `<div>` child of #sk_usage so
   * the `#sk_usage>div` column layout keeps applying.
   */
  groups: string[];
  /** Localized "More help" link text. */
  moreHelp: string;
};

/** The usage/help panel (#sk_usage), shown for `?`. */
export const Usage: Component<UsageProps> = (props) => {
  return (
    <>
      <For each={props.groups}>{(group) => <div ref={(el) => setSafeHtml(el, () => group)} />}</For>
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
