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
      ref={(el) => props.ref?.(el)}
      value={props.value}
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
