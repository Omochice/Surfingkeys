import { For, Show } from "solid-js";
import type { Component } from "solid-js";

import { ResultItem } from "./ResultItem";

export type ResultListItem = {
  html: string;
  /** Extra class on the row, e.g. "window". */
  className?: string;
  faviconSrc?: string;
};

export type ResultListProps = {
  items: ResultListItem[];
  /** Index of the focused row, or -1 when none is focused. */
  focusedIndex: number;
  onSelect: (index: number) => void;
};

/**
 * The omnibar result list (#sk_omnibarSearchResult). Nothing is rendered when the list is empty, so
 * the container stays `:empty` and its CSS hides it.
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
