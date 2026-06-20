import { SAFE_HTML_OPTIONS } from "@sk/core/utils";
import { createRenderEffect } from "solid-js";

/**
 * Injects sanitized HTML into an element via the standard HTML Sanitizer API (`Element.setHTML`),
 * re-running whenever the reactive `html` accessor changes. This replaces the per-component
 * `innerHTML={DOMPurify.sanitize(...)}` bindings: the sanitization now happens in the browser's
 * parser instead of a bundled library.
 *
 * A render effect (not `createEffect`) is used so the markup is injected synchronously during
 * rendering, exactly as Solid's own `innerHTML` binding did. Components such as ResultItem read the
 * injected nodes in `onMount`, which runs after render effects but before deferred effects, so the
 * content must already be present by then.
 *
 * Use it as a `ref` callback so the effect is owned by the surrounding component and torn down with
 * it: `<span ref={(el) => setSafeHtml(el, () => props.html)} />`.
 */
export const setSafeHtml = (el: Element, html: () => string): void => {
  createRenderEffect(() => {
    el.setHTML(html(), SAFE_HTML_OPTIONS);
  });
};
