import type { Component } from "solid-js";

export interface SearchInputProps {
  /** Bound text value; controlled. */
  value: string;
  /** When false, the element renders with `display: none`. */
  visible: boolean;
  /** Placeholder text shown when the value is empty. */
  placeholder: string;
  /**
   * Fires with the input's current value for non-composing input events (`event.isComposing ===
   * false`) and once on `compositionend` carrying the final committed text. IME composition-phase
   * events are suppressed so the controller's query pipeline only sees committed text.
   */
  onInput: (value: string) => void;
  /**
   * Fires for non-composing keystrokes. KeyboardEvents with `isComposing === true` are suppressed
   * (the IME owns those keys).
   */
  onKeyDown: (event: KeyboardEvent) => void;
  /**
   * Receives the underlying <input> element so the controller can call
   * focus/selectionStart/setSelectionRange.
   */
  ref?: (el: HTMLInputElement) => void;
}

/**
 * The omnibar search `<input>` (`#sk_omnibarSearchArea` input). The value is controlled through a
 * `query` signal in the omnibar controller, but the IME composition is honored per W3C UI Events /
 * Input Events Level 2: input and keydown events with `isComposing` true are filtered out, and
 * `compositionend` re-emits the committed value once as a safety net for browsers that fire `input`
 * before `compositionend`. Imperative DOM operations (focus, selection) stay with the controller
 * through the forwarded ref because they aren't meaningfully expressible as props.
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
        props.onInput((event.currentTarget as HTMLInputElement).value);
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
