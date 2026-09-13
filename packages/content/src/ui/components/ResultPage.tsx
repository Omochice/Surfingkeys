import { Show } from "solid-js";
import type { Component } from "solid-js";

export type ResultPageProps = {
  /** Pagination label (e.g. "1 - 10 / 50"); shown verbatim, hidden while empty. */
  text: string;
};

/** The omnibar result-page indicator (#sk_omnibarSearchArea > span.resultPage). */
export const ResultPage: Component<ResultPageProps> = (props) => {
  return <Show when={props.text}>{props.text}</Show>;
};
