import { Show } from "solid-js";
import type { Component } from "solid-js";

export type BannerProps = {
  /** Message text; shown verbatim and hidden while empty. */
  text: string;
};

/** Transient banner shown at the top of the frontend iframe. */
export const Banner: Component<BannerProps> = (props) => {
  return <Show when={props.text}>{props.text}</Show>;
};
