import { SAFE_HTML_OPTIONS } from "@sk/core/utils";
import { createRenderEffect } from "solid-js";

/**
 * Ref factory that injects sanitized HTML into the element via the standard HTML Sanitizer API
 * (`Element.setHTML`), re-injecting whenever the reactive `html` accessor changes.
 *
 * Call it in the component body (e.g. `ref={setSafeHtml(() => props.html)}`), not inside a ref
 * callback.
 *
 * @param html Accessor for the markup to inject.
 * @returns The ref callback that binds the element.
 */
export const setSafeHtml = (html: () => string): ((el: Element) => void) => {
  let target: Element | undefined;
  let latest: string | undefined;
  // createEffect would queue the injection beside user effects, which could then read the previous
  // markup.
  createRenderEffect(html, (value) => {
    latest = value;
    target?.setHTML(value, SAFE_HTML_OPTIONS);
  });
  return (el) => {
    target = el;
    if (latest != null) {
      el.setHTML(latest, SAFE_HTML_OPTIONS);
    }
  };
};
