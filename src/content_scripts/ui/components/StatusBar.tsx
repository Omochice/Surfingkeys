import DOMPurify from "dompurify";
import { Index } from "solid-js";
import type { Component } from "solid-js";

export interface StatusBarProps {
  /**
   * Raw HTML for each status cell (mode, search, search result, proxy). Empty cells render no
   * padding or border so they collapse; the caller hides the whole bar when every cell is empty.
   */
  cells: string[];
}

/**
 * Status line shown in the frontend iframe. A reactive Solid replacement for the imperative
 * `showStatus` DOM updates in the legacy frontend.
 *
 * Each cell is injected as sanitized HTML (the search cell carries the find `<input>` the legacy
 * code reaches into), so the markup is run through DOMPurify at the injection point exactly as the
 * old `setSanitizedContent` did. Non-empty cells get padding and a divider; the divider is dropped
 * on the last non-empty cell so the bar has no trailing separator.
 */
export const StatusBar: Component<StatusBarProps> = (props) => {
  const lastNonEmpty = () => {
    let last = -1;
    for (let i = 0; i < props.cells.length; i++) {
      if (props.cells[i]) {
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
            cell()
              ? {
                  padding: "0px 8px",
                  "border-right": i === lastNonEmpty() ? "" : "1px solid #999",
                }
              : { padding: "", "border-right": "" }
          }
          innerHTML={DOMPurify.sanitize(cell())}
        />
      )}
    </Index>
  );
};
