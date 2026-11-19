import { createRenderEffect } from "solid-js";
import type { Component } from "solid-js";

export type SearchInputProps = {
  value: string;
  /** When false, the element renders with `display: none`. */
  visible: boolean;
  placeholder: string;
  /** Fires only with committed text: composition-phase events are suppressed. */
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  ref?: (el: HTMLInputElement) => void;
};

function bindValue(value: () => string): (el: HTMLInputElement) => void {
  let target: HTMLInputElement | undefined;
  let latest: string | undefined;
  createRenderEffect(value, (next) => {
    latest = next;
    if (target != null) {
      target.value = next;
    }
  });
  return (el) => {
    target = el;
    if (latest != null) {
      el.value = latest;
    }
  };
}

/**
 * The omnibar search `<input>` (`#sk_omnibarSearchArea` input).
 *
 * IME composition is honored per W3C UI Events / Input Events Level 2: input and keydown events
 * with `isComposing` true are filtered out, and `compositionend` re-emits the committed value once
 * as a safety net for browsers that fire `input` before `compositionend`.
 */
export const SearchInput: Component<SearchInputProps> = (props) => {
  return (
    <input
      // A `value` attribute would share the template's grouped binding, so a placeholder or
      // visibility change would write the last `value` back over text edited in place.
      ref={[bindValue(() => props.value), (el) => props.ref?.(el)]}
      placeholder={props.placeholder}
      style={{ display: props.visible ? "" : "none" }}
      onInput={(event) => {
        if (event.isComposing) {
          return;
        }
        props.onInput(event.currentTarget.value);
      }}
      onCompositionEnd={(event) => {
        props.onInput(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.isComposing) {
          return;
        }
        props.onKeyDown(event);
      }}
    />
  );
};
