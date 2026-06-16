import { Show } from "solid-js";
import type { Component } from "solid-js";

export type ResultPageProps = {
  /** Pagination label (e.g. "1 - 10 / 50"); shown verbatim, hidden while empty. */
  text: string;
};

/**
 * The omnibar result-page indicator (#sk_omnibarSearchArea > span.resultPage). The legacy code set
 * the count via setSanitizedContent with a plain string, so it was always literal text; Solid's
 * text interpolation escapes it the same way. The span stays in the markup as the mount container
 * and as the anchor the controller inserts the search <input> before.
 */
export const ResultPage: Component<ResultPageProps> = (props) => {
  return <Show when={props.text}>{props.text}</Show>;
};
