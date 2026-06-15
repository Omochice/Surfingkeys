import { For, Show } from "solid-js";
import type { Component } from "solid-js";

import { ResultItem } from "./ResultItem";

export type ResultListItem = {
  /** Inner HTML of the row. */
  html: string;
  /** Extra class on the row, e.g. "window". */
  className?: string;
  /** Favicon URL applied to the row's `<img class=icon>` after render. */
  faviconSrc?: string;
};

export type ResultListProps = {
  items: ResultListItem[];
  /** Index of the focused row, or -1 when none is focused. */
  focusedIndex: number;
  /** Invoked with the row index when a row is clicked. */
  onSelect: (index: number) => void;
};

/**
 * The omnibar result list (#sk_omnibarSearchResult). Renders a <ul> of ResultItem rows from a
 * results array, with focus driven by a focusedIndex so the omnibar's store can move the selection
 * reactively. Nothing is rendered when the list is empty, keeping the container :empty so its CSS
 * hides it as the legacy `setSanitizedContent(resultsDiv, "")` did.
 */
export const ResultList: Component<ResultListProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      <ul>
        <For each={props.items}>
          {(item, i) => (
            <ResultItem
              html={item.html}
              className={item.className}
              faviconSrc={item.faviconSrc}
              focused={i() === props.focusedIndex}
              onSelect={() => props.onSelect(i())}
            />
          )}
        </For>
      </ul>
    </Show>
  );
};
