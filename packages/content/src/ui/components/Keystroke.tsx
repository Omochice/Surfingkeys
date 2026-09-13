import { Show } from "solid-js";
import type { Component } from "solid-js";

import { setSafeHtml } from "../setSafeHtml";

export type KeystrokeProps = {
  /** The accumulated decoded keys while a chord is being typed. Rendered as text when not `rich`. */
  text: string;
  /** The annotated candidate list shown once rich hints expand. Sanitized HTML, used when `rich`. */
  html: string;
  rich: boolean;
};

/**
 * Keystroke hint shown at the bottom-right of the frontend iframe.
 *
 * `expandRichHints` sits on the rendered child rather than the container; the CSS rules are
 * descendant selectors, so either position styles identically. The plain chord keys are rendered as
 * a text node so they never reach `innerHTML`; only the rich hint layout is sanitized.
 */
export const Keystroke: Component<KeystrokeProps> = (props) => {
  return (
    <div classList={{ expandRichHints: props.rich }}>
      <Show
        when={props.rich}
        fallback={props.text}
      >
        <span ref={(el) => setSafeHtml(el, () => props.html)} />
      </Show>
    </div>
  );
};
