import DOMPurify from "dompurify";
import { Index, Show } from "solid-js";
import type { Component } from "solid-js";

/**
 * A single status cell. A plain string is rendered as a text node (the mode name and the search
 * result count are plain text); an `{ html }` cell is injected as sanitized HTML (only the search
 * cell needs this, to carry the find `<input>` the legacy code reaches into).
 */
export type StatusCell = string | { html: string };

export type StatusBarProps = {
  /**
   * The status cells (mode, search, search result). Empty cells render no padding or border so they
   * collapse; the caller hides the whole bar when every cell is empty.
   */
  cells: StatusCell[];
};

const isEmpty = (cell: StatusCell): boolean => cell === "";

const htmlCell = (cell: StatusCell): { html: string } | null =>
  typeof cell === "object" ? cell : null;

const textCell = (cell: StatusCell): string => (typeof cell === "string" ? cell : "");

/**
 * Status line shown in the frontend iframe. A reactive Solid replacement for the imperative
 * `showStatus` DOM updates in the legacy frontend.
 *
 * Text cells render as text nodes; only the search cell carries markup (the find `<input>`), so it
 * is the sole cell run through DOMPurify. Keeping plain text out of `innerHTML` removes it from the
 * sanitization path entirely rather than relying on DOMPurify to pass it through unchanged.
 * Non-empty cells get padding and a divider; the divider is dropped on the last non-empty cell so
 * the bar has no trailing separator.
 */
export const StatusBar: Component<StatusBarProps> = (props) => {
  const lastNonEmpty = () => {
    let last = -1;
    for (let i = 0; i < props.cells.length; i++) {
      if (!isEmpty(props.cells[i]!)) {
        last = i;
      }
    }
    return last;
  };

  return (
    <Index each={props.cells}>
      {(cell, i) => (
        <span
          style={
            !isEmpty(cell())
              ? {
                  padding: "0px 8px",
                  "border-right": i === lastNonEmpty() ? "" : "1px solid #999",
                }
              : { padding: "", "border-right": "" }
          }
        >
          <Show
            when={htmlCell(cell())}
            fallback={textCell(cell())}
          >
            {(html) => <span innerHTML={DOMPurify.sanitize(html().html)} />}
          </Show>
        </span>
      )}
    </Index>
  );
};
