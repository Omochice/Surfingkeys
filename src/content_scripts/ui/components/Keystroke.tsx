import DOMPurify from "dompurify";
import { Show } from "solid-js";
import type { Component } from "solid-js";

export type KeystrokeProps = {
  /** The accumulated decoded keys while a chord is being typed. Rendered as text when not `rich`. */
  text: string;
  /** The annotated candidate list shown once rich hints expand. Sanitized HTML, used when `rich`. */
  html: string;
  /** Whether the expanded rich-hint layout (annotations) is active. */
  rich: boolean;
};

/**
 * Keystroke hint shown at the bottom-right of the frontend iframe. The legacy code set
 * #sk_keystroke's innerHTML directly and toggled `expandRichHints` on the container; here the class
 * sits on the rendered child instead. The CSS rules are descendant selectors, so the styling is
 * unchanged, and the controller in frontend.ts keeps owning the container's display, the chord
 * accumulation, and the rich-hint delay timer.
 *
 * The plain chord keys are rendered as a text node so they never reach `innerHTML`; only the rich
 * hint layout carries markup and is run through DOMPurify.
 */
export const Keystroke: Component<KeystrokeProps> = (props) => {
  return (
    <div classList={{ expandRichHints: props.rich }}>
      <Show
        when={props.rich}
        fallback={props.text}
      >
        <span innerHTML={DOMPurify.sanitize(props.html)} />
      </Show>
    </div>
  );
};
