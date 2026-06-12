import { suppressNextScrollEvent } from "./mode";
import { listElements } from "./utils";

/**
 * Detect whether `el` can scroll by at least `barSize` pixels along `direction` — elements that
 * scroll only a smaller amount report false. When the current offset is below the threshold the
 * element is probed by writing a scroll offset and reading it back; the probe can fire a real
 * scroll event, which the mode event hub is told to swallow via {@link suppressNextScrollEvent}.
 */
function hasScroll(el: HTMLElement, direction: "x" | "y", barSize: number): boolean {
  const offset =
    direction === "y" ? (["scrollTop", "height"] as const) : (["scrollLeft", "width"] as const);
  let result = el[offset[0]];

  if (result < barSize) {
    // probe: write the element's client-rect size as the scroll offset and read back how far it
    // actually moved
    const originOffset = el[offset[0]];
    el[offset[0]] = el.getBoundingClientRect()[offset[1]];
    result = el[offset[0]];
    if (result !== originOffset) {
      // this is valid for some site such as http://mail.live.com/
      suppressNextScrollEvent();
    }
    el[offset[0]] = originOffset;
  }
  return result >= barSize;
}

/**
 * Collect the page's scrollable elements, innermost-and-largest first, prefixed by the scrolling
 * element. This is heuristic, not exhaustive: only elements scrollable by ≥16px whose scroll size
 * exceeds 200px qualify, and the result is empty when the document has no `<body>`.
 */
function getScrollableElements(): HTMLElement[] {
  // The document may have no <body> yet (document_start) or at all (XML/SVG documents).
  if (!document.body) {
    return [];
  }
  const nodes = listElements(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    (n: HTMLElement) =>
      (hasScroll(n, "y", 16) && n.scrollHeight > 200) ||
      (hasScroll(n, "x", 16) && n.scrollWidth > 200),
  ).toSorted((a: HTMLElement, b: HTMLElement) => {
    if (b.contains(a)) return 1;
    else if (a.contains(b)) return -1;
    return b.scrollHeight * b.scrollWidth - a.scrollHeight * a.scrollWidth;
  });
  // document.scrollingElement will be null when document.body.tagName === "FRAMESET".
  // It belongs to this content script's own document, so instanceof is realm-safe here.
  const scrollingElement = document.scrollingElement;
  if (
    scrollingElement instanceof HTMLElement &&
    (scrollingElement.scrollHeight > window.innerHeight ||
      scrollingElement.scrollWidth > window.innerWidth)
  ) {
    nodes.unshift(scrollingElement);
  }
  return nodes;
}

export { getScrollableElements, hasScroll };
