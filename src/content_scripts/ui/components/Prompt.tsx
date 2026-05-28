import DOMPurify from "dompurify";
import type { Component } from "solid-js";

export interface PromptProps {
  /** Prompt label HTML (handler name, separator span, search-engine icon); sanitized at injection. */
  html: string;
}

/**
 * The omnibar prompt label (#sk_omnibarSearchArea > span.prompt). The legacy code set it via
 * setSanitizedContent because the prompt carries markup (the `➤` separator span and
 * per-search-engine `<img>` icons), so only that injection moves to Solid. A `<span>` host is used
 * rather than Bubble's `<div>` to keep the inline-block flex layout of the search area intact.
 */
export const Prompt: Component<PromptProps> = (props) => {
  return <span innerHTML={DOMPurify.sanitize(props.html)} />;
};
