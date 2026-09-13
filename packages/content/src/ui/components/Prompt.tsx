import { Show } from "solid-js";
import type { Component } from "solid-js";

import { setSafeHtml } from "../setSafeHtml";

const SEPARATOR = "➤";

/**
 * The omnibar prompt content: a plain text label, or raw HTML for the per-search-engine `<img>`
 * icon, whose `src` comes from storage or a remote fetch and so must be sanitized.
 */
export type PromptValue = string | { html: string };

export type PromptProps = {
  value: PromptValue;
};

/**
 * The omnibar prompt label (#sk_omnibarSearchArea > span.prompt). A text label renders as a text
 * node, keeping the common case out of `innerHTML`.
 */
export const Prompt: Component<PromptProps> = (props) => {
  return (
    <Show
      when={typeof props.value === "object" && props.value}
      fallback={
        <>
          {props.value}
          <span class="separator">{SEPARATOR}</span>
        </>
      }
    >
      {(value) => <span ref={(el) => setSafeHtml(el, () => value().html)} />}
    </Show>
  );
};
