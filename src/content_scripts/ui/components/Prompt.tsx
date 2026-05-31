import DOMPurify from "dompurify";
import { Show } from "solid-js";
import type { Component } from "solid-js";

/** The arrow drawn between the prompt label and the omnibar input. */
const SEPARATOR = "➤";

/**
 * The omnibar prompt content: either a plain text label (the handler name, shown with the styled
 * separator) or raw HTML (the per-search-engine `<img>` icon, whose `src` comes from storage or a
 * remote fetch and so must be sanitized).
 */
export type PromptValue = string | { html: string };

export type PromptProps = {
  value: PromptValue;
};

/**
 * The omnibar prompt label (#sk_omnibarSearchArea > span.prompt). A text label renders as a text
 * node followed by the styled separator span, keeping the common case out of `innerHTML`; only the
 * search-engine icon HTML still needs DOMPurify.
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
      {(value) => <span innerHTML={DOMPurify.sanitize(value().html)} />}
    </Show>
  );
};
