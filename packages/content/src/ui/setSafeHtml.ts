import { SAFE_HTML_OPTIONS } from "@sk/core/utils";
import { createRenderEffect } from "solid-js";

/**
 * Injects sanitized HTML into an element via the standard HTML Sanitizer API (`Element.setHTML`),
 * re-running whenever the reactive `html` accessor changes.
 *
 * A render effect rather than `createEffect` so the markup is injected synchronously during
 * rendering: components reading the injected nodes in `onMount` run after render effects but before
 * deferred effects, so the content must already be present by then.
 */
export const setSafeHtml = (el: Element, html: () => string): void => {
  createRenderEffect(() => {
    el.setHTML(html(), SAFE_HTML_OPTIONS);
  });
};
