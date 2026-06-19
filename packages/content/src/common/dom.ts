/**
 * `window.frameElement` belongs to the embedding parent document, which is a different realm, so
 * `instanceof HTMLElement` against this realm's constructor would be `false` even for a real
 * same-origin frame. This duck-typed guard probes for the layout-offset properties directly, which
 * is realm-agnostic, and narrows to the offset-bearing shape the callers read.
 */
type LayoutOffsetElement = Element & {
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
};

function hasLayoutOffsets(el: Element | null): el is LayoutOffsetElement {
  return el !== null && "offsetLeft" in el;
}

export { hasLayoutOffsets };
