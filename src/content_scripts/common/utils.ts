import DOMPurify from "dompurify";

import browser from "./browser";
import KeyboardUtils from "./keyboardUtils";
import { RUNTIME, dispatchSKEvent, runtime } from "./runtime.js";
import type Trie from "./trie";
import type { TrieMeta } from "./trie";

declare global {
  interface String {
    /** Positional substitution: "{0}/{1}".format(a, b). */
    format(...args: unknown[]): string;
    reverse(): string;
  }
  interface RegExp {
    toJSON(): { source: string; flags: string };
  }
  interface DOMRect {
    /** Hit test of (x, y) with tolerances ex/ey on each axis. */
    has(x: number, y: number, ex: number, ey: number): boolean;
  }
  interface HTMLElement {
    one(evt: string, handler: (this: HTMLElement) => void): void;
    show(): void;
    hide(): void;
    removeAttributes(): void;
    containsWithShadow(e: Node): boolean;
  }
  interface NodeList {
    remove(): void;
    show(): void;
    hide(): void;
  }
}

const colors = [
  "#4169E1", // Royal Blue
  "#E74C3C", // Bright Red
  "#2ECC71", // Emerald Green
  "#9B59B6", // Amethyst Purple
  "#F39C12", // Orange
  "#16A085", // Teal
  "#E67E22", // Dark Orange
  "#3498DB", // Bright Blue
  "#C0392B", // Dark Red
  "#27AE60", // Forest Green
  "#8E44AD", // Wisteria Purple
  "#D35400", // Pumpkin Orange
  "#2980B9", // Ocean Blue
  "#FF5733", // Coral Red
  "#1ABC9C", // Turquoise
  "#8B008B", // Dark Magenta
  "#F1C40F", // Yellow
  "#008080", // Dark Teal
  "#FF8C00", // Dark Orange
  "#4682B4", // Steel Blue
  "#8B0000", // Dark Red
  "#32CD32", // Lime Green
  "#9932CC", // Dark Orchid
  "#FF4500", // Orange Red
  "#1E90FF", // Dodger Blue
  "#DC143C", // Crimson
  "#20B2AA", // Light Sea Green
  "#BA55D3", // Medium Orchid
  "#DAA520", // Goldenrod
  "#008B8B", // Dark Cyan
  "#CD853F", // Peru
  "#6495ED", // Cornflower Blue
  "#B22222", // Fire Brick
  "#3CB371", // Medium Sea Green
  "#9370DB", // Medium Purple
  "#A0522D", // Sienna
  "#87CEEB", // Sky Blue
  "#CD5C5C", // Indian Red
  "#48D1CC", // Medium Turquoise
  "#DDA0DD", // Plum
  "#FFD700", // Gold
  "#5F9EA0", // Cadet Blue
  "#FFA07A", // Light Salmon
  "#00BFFF", // Deep Sky Blue
  "#8B4513", // Saddle Brown
  "#90EE90", // Light Green
  "#FF69B4", // Hot Pink
  "#D2691E", // Chocolate
  "#B0C4DE", // Light Steel Blue
  "#FA8072", // Salmon
  "#66CDAA", // Medium Aquamarine
  "#DB7093", // Pale Violet Red
  "#FF8C69", // Salmon Pink
  "#556B2F", // Dark Olive Green
  "#FF7F50", // Coral
  "#2E8B57", // Sea Green
  "#9400D3", // Dark Violet
  "#B8860B", // Dark Goldenrod
  "#FF6347", // Tomato
  "#40E0D0", // Turquoise
  "#DA70D6", // Orchid
  "#BDB76B", // Dark Khaki
  "#F4A460", // Sandy Brown
  "#87CEFA", // Light Sky Blue
  "#98FB98", // Pale Green
  "#C71585", // Medium Violet Red
  "#B0E0E6", // Powder Blue
  "#F08080", // Light Coral
  "#7FFFD4", // Aquamarine
  "#FFA500", // Orange
  "#FF6B6B", // Light Red
  "#00CED1", // Dark Turquoise
  "#E9967A", // Dark Salmon
  "#4B0082", // Indigo
  "#7B68EE", // Medium Slate Blue
  "#6A5ACD", // Slate Blue
  "#483D8B", // Dark Slate Blue
  "#5D478B", // Medium Purple 4
  "#8A2BE2", // Blue Violet
  "#7EC0EE", // Sky Blue 2
  "#009ACD", // Deep Sky Blue 3
  "#00868B", // Turquoise 4
  "#00C78C", // Medium Spring Green
  "#00CD66", // Spring Green 3
  "#66CD00", // Chartreuse 3
  "#CDCD00", // Yellow 3
  "#CD9B1D", // Goldenrod 3
  "#CD6600", // Dark Orange 3
  "#CD4F39", // Tomato 3
  "#CD3278", // Violet Red 3
  "#CD3333", // Brown 3
  "#8B4789", // Orchid 4
  "#8B8B00", // Yellow 4
  "#8B7355", // Rosy Brown 4
  "#8B636C", // Pink 4
  "#2F4F4F", // Dark Slate Gray
  "#FF1493", // Deep Pink
  "#800080", // Purple
  "#708090", // Slate Gray
  "#6B8E23", // Olive Drab
];
function getColor(i: number): string {
  return colors[i] as string;
}

function isEmptyObject(obj: object): boolean {
  for (const _name in obj) {
    return false;
  }
  return true;
}

function applyUserSettings(delta: { error: string; settings: Record<string, unknown> }): void {
  if (delta.error !== "") {
    if (window === top) {
      showPopup("[SurfingKeys] Error found in settings: " + delta.error);
    } else {
      console.log(
        "[SurfingKeys] Error found in settings({0}): {1}".format(window.location.href, delta.error),
      );
    }
  }
  if (!isEmptyObject(delta.settings)) {
    dispatchSKEvent("front", ["applySettingsFromSnippets", delta.settings]);
  }
}

/**
 * Get current browser name
 *
 * @returns {string} "Chrome" | "Firefox"
 */
function getBrowserName(): "Chrome" | "Firefox" {
  if (window.navigator.userAgent.indexOf("Chrome") !== -1) {
    return "Chrome";
  } else if (window.navigator.userAgent.indexOf("Firefox") !== -1) {
    return "Firefox";
  }
  return "Chrome";
}

function isInUIFrame(): boolean {
  return window !== top && document.location.href.indexOf(browser.runtime.getURL("/")) === 0;
}

function timeStampString(t: number): string {
  const dt = new Date();
  dt.setTime(t);
  return dt.toLocaleString();
}

function getDocumentOrigin(): string {
  // https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
  // Lastly, posting a message to a page at a file: URL currently requires that the targetOrigin argument be "*".
  // file:// cannot be used as a security restriction; this restriction may be modified in the future.
  // Firefox provides window.origin instead of document.origin.
  let origin = window.location.origin ? window.location.origin : "*";
  if (origin === "file://" || origin === "null") {
    origin = "*";
  }
  return origin;
}

function generateQuickGuid(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function listElements<T extends Node = Element>(
  root: Node,
  whatToShow: number,
  filter: (node: T) => boolean,
): T[] {
  const elms: T[] = [];
  const nodeIterator = document.createNodeIterator(root, whatToShow, null);

  let currentNode = nodeIterator.nextNode();
  while (currentNode) {
    const node = currentNode as T;
    filter(node) && elms.push(node);

    const shadowRoot = (currentNode as Element).shadowRoot;
    if (shadowRoot) {
      elms.push(...listElements<T>(shadowRoot, whatToShow, filter));
    }
    currentNode = nodeIterator.nextNode();
  }

  return elms;
}

function isElementClickable(e: Element): boolean {
  let cssSelector =
    "a, button, select, input, textarea, summary, *[onclick], *[contenteditable=true], *.jfk-button, *.goog-flat-menu-button, *[role=button], *[role=link], *[role=menuitem], *[role=option], *[role=switch], *[role=tab], *[role=checkbox], *[role=combobox], *[role=menuitemcheckbox], *[role=menuitemradio]";
  if (runtime.conf.clickableSelector.length) {
    cssSelector += ", " + runtime.conf.clickableSelector;
  }

  return (
    e.matches(cssSelector) ||
    getComputedStyle(e).cursor === "pointer" ||
    getComputedStyle(e).cursor.substr(0, 4) === "url(" ||
    e.closest("a, *[onclick], *[contenteditable=true], *.jfk-button, *.goog-flat-menu-button") !==
      null
  );
}

/**
 * Show message in banner.
 *
 * @example
 *   Front.showBanner(window.location.href);
 *
 * @param {string} msg The message to be displayed in banner.
 * @param {number} [timeout=1600] Milliseconds after which the banner will disappear. Default is
 *   `1600`
 * @name Front.showBanner
 */
function showBanner(msg: string, timeout?: number): void {
  dispatchSKEvent("front", ["showBanner", msg, timeout]);
}

/**
 * Show message in popup.
 *
 * @example
 *   Front.showPopup(window.location.href);
 *
 * @param {string} msg The message to be displayed in popup.
 * @name Front.showPopup
 */
function showPopup(msg: string): void {
  dispatchSKEvent("front", ["showPopup", msg]);
}

function initSKFunctionListener(
  name: string,
  interfaces: Record<string, (...args: any[]) => void>,
  capture?: boolean,
): Record<string, (...args: any[]) => void> {
  const callbacks: Record<string, (...args: any[]) => void> = {};

  const opts = capture ? { capture: true } : {};
  document.addEventListener(
    `surfingkeys:${name}`,
    (evt) => {
      const args = (evt as CustomEvent).detail as any[];
      const fk = args.shift();
      if (capture) {
        const target = (evt as CustomEvent).target;
        if (
          args.length > 0 &&
          args[0].constructor.name === "Array" &&
          args[0][0] === "__EVENT_TARGET__"
        ) {
          // restore args from evt.target, see src/content_scripts/common/hints.js:442
          args[0][0] = target;
        } else {
          args.push(target);
        }
      }

      if (Object.prototype.hasOwnProperty.call(callbacks, fk)) {
        const cb = callbacks[fk];
        if (cb) {
          cb(...args);
        }
        delete callbacks[fk];
      }
      if (Object.prototype.hasOwnProperty.call(interfaces, fk)) {
        const iface = interfaces[fk];
        if (iface) {
          iface(...args);
        }
      }
    },
    opts,
  );

  return callbacks;
}

function dispatchMouseEvent(
  element: Element,
  events: string[],
  modifiers: {
    ctrlKey?: boolean | undefined;
    altKey?: boolean | undefined;
    shiftKey?: boolean | undefined;
    metaKey?: boolean | undefined;
  },
): void {
  events.forEach((eventName) => {
    const event = new MouseEvent(eventName, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      ...(modifiers.ctrlKey !== undefined && { ctrlKey: modifiers.ctrlKey }),
      ...(modifiers.altKey !== undefined && { altKey: modifiers.altKey }),
      ...(modifiers.shiftKey !== undefined && { shiftKey: modifiers.shiftKey }),
      ...(modifiers.metaKey !== undefined && { metaKey: modifiers.metaKey }),
    });
    element.dispatchEvent(event);
  });
}

function getRealEdit(event?: Event): any {
  let rt: any = event ? event.target : document.activeElement;
  // on some pages like chrome://history/, input is in shadowRoot of several other recursive shadowRoots.
  while (rt && rt.shadowRoot) {
    if (rt.shadowRoot.activeElement) {
      rt = rt.shadowRoot.activeElement;
    } else if (rt.shadowRoot.querySelector("input, textarea, select")) {
      rt = rt.shadowRoot.querySelector("input, textarea, select");
      break;
    } else {
      break;
    }
  }
  if (rt === window) {
    rt = document.body;
  }
  return rt;
}

function toggleQuote(): void {
  const elm = getRealEdit(),
    val = elm.value;
  if (val.match(/^"|"$/)) {
    elm.value = val.replace(/^"?(.*?)"?$/, "$1");
  } else {
    elm.value = '"' + val + '"';
  }
}

function isEditable(element: any): boolean {
  return (
    element &&
    !element.disabled &&
    (element.localName === "textarea" ||
      element.localName === "select" ||
      element.isContentEditable ||
      (element.matches && element.matches(runtime.conf.editableSelector)) ||
      (element.localName === "input" &&
        /^(?!button|checkbox|file|hidden|image|radio|reset|submit)/i.test(element.type)))
  );
}

function reportIssue(title: string, description: string): void {
  title = encodeURIComponent(title);
  description =
    "%23%23+Error+details%0A%0A{0}%0A%0ASurfingKeys%3A+{1}%0A%0AChrome%3A+{2}%0A%0AURL%3A+{3}%0A%0A%23%23+Context%0A%0A%2A%2APlease+replace+this+with+a+description+of+how+you+were+using+SurfingKeys.%2A%2A".format(
      encodeURIComponent(description),
      browser.runtime.getManifest().version,
      encodeURIComponent(navigator.userAgent),
      encodeURIComponent(window.location.href),
    );
  const error =
    '<h2>Uh-oh! The SurfingKeys extension encountered a bug.</h2> <p>Please click <a href="https://github.com/brookhong/Surfingkeys/issues/new?title={0}&body={1}" target=_blank>here</a> to start filing a new issue, append a description of how you were using SurfingKeys before this message appeared, then submit it.  Thanks for your help!</p>'.format(
      title,
      description,
    );

  showPopup(error);
}

function scrollIntoViewIfNeeded(elm: Element, ignoreSize?: boolean): void {
  const e = elm as Element & { scrollIntoViewIfNeeded?: () => void };
  if (e.scrollIntoViewIfNeeded) {
    e.scrollIntoViewIfNeeded();
  } else if (!isElementPartiallyInViewport(elm, ignoreSize)) {
    elm.scrollIntoView();
  }
}

function isElementDrawn(e: Element, rect?: DOMRect): boolean {
  const min = isEditable(e) ? 1 : 4;
  rect = rect || e.getBoundingClientRect();
  return (
    rect.width > min &&
    rect.height > min &&
    (parseFloat(getComputedStyle(e).opacity) > 0.1 ||
      (e.tagName == "INPUT" && (e as HTMLInputElement).type != "text"))
  );
}

/**
 * Check whether an element is in viewport.
 *
 * @param {Element} el The element to be checked.
 * @param {boolean} [ignoreSize=false] Whether to ignore size of the element, otherwise the element
 *   must be with size 4*4. Default is `false`
 * @returns {boolean}
 */
function isElementPartiallyInViewport(el: Element, ignoreSize?: boolean): boolean {
  const rect = el.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    (ignoreSize || isElementDrawn(el, rect)) &&
    rect.top < windowHeight &&
    rect.bottom > 0 &&
    rect.left < windowWidth &&
    rect.right > 0
  );
}

function getVisibleElements(
  filter: (e: HTMLElement, visibleElements: HTMLElement[]) => void,
): HTMLElement[] {
  const all = Array.from(document.documentElement.getElementsByTagName("*"));
  const visibleElements: HTMLElement[] = [];
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e === undefined) {
      continue;
    }
    // include elements in a shadowRoot.
    if (e.shadowRoot) {
      const cc = e.shadowRoot.querySelectorAll("*");
      for (let j = 0; j < cc.length; j++) {
        const child = cc[j];
        if (child !== undefined) {
          all.push(child);
        }
      }
    }
    const rect = e.getBoundingClientRect();
    if (
      rect.top <= window.innerHeight &&
      rect.bottom >= 0 &&
      rect.left <= window.innerWidth &&
      rect.right >= 0 &&
      rect.height > 0 &&
      getComputedStyle(e).visibility !== "hidden"
    ) {
      filter(e as HTMLElement, visibleElements);
    }
  }
  return visibleElements;
}

/**
 * Get large elements that are currently visible in the viewport. A large element is defined as one
 * that takes up a significant portion of the viewport.
 *
 * @example
 *   // Get elements that are at least 30% of viewport dimensions
 *   var largeElements = getLargeElements();
 *
 *   // Get elements that are at least 50% of viewport dimensions
 *   var veryLargeElements = getLargeElements(0.5, 0.5);
 *
 * @param {number} [minWidth=0.3] Minimum width as a fraction of viewport width (0.0 to 1.0).
 *   Default is `0.3`
 * @param {number} [minHeight=0.3] Minimum height as a fraction of viewport height (0.0 to 1.0).
 *   Default is `0.3`
 * @returns {Element[]} Array of large visible elements
 */
function getLargeElements(minWidth = 0.3, minHeight = 0.3): HTMLElement[] {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const minWidthPx = viewportWidth * minWidth;
  const minHeightPx = viewportHeight * minHeight;

  let lastRect = new DOMRect(0, 0, 0, 0);
  const elements = getVisibleElements((element, visibleElements) => {
    if (element === document.body) return;
    const rect = element.getBoundingClientRect();
    const tolerance = 16;
    if (
      Math.abs(rect.x - lastRect.x) < tolerance &&
      Math.abs(rect.y - lastRect.y) < tolerance &&
      Math.abs(rect.width - lastRect.width) < tolerance &&
      Math.abs(rect.height - lastRect.height) < tolerance
    ) {
      return;
    }
    if (Math.abs(viewportWidth - rect.width) < 4 && Math.abs(viewportHeight - rect.height) < 4) {
      return;
    }
    if (rect.width < minWidthPx && rect.height < minHeightPx) return;
    if ((rect.width / viewportWidth) * (rect.height / viewportHeight) < (minWidth * minHeight) / 6)
      return;
    const style = getComputedStyle(element);
    if (
      parseFloat(style.opacity) > 0.1 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    ) {
      visibleElements.push(element);
      lastRect = rect;
    }
  });
  return elements;
}

function actionWithSelectionPreserved(cb: (selection: Selection | null) => void): void {
  const selection = document.getSelection()!;
  const pos: [string, Node | null, number, Node | null, number] = [
    selection.type,
    selection.anchorNode,
    selection.anchorOffset,
    selection.focusNode,
    selection.focusOffset,
  ];

  const dt = document.scrollingElement!.scrollTop;

  cb(selection);

  document.scrollingElement!.scrollTop = dt;

  if (pos[0] === "None") {
    selection.empty();
  } else if (pos[0] === "Caret") {
    selection.setPosition(pos[3], pos[4]);
  } else if (pos[0] === "Range") {
    selection.setPosition(pos[1], pos[2]);
    selection.extend(pos[3]!, pos[4]);
  }
}

function filterAncestors(elements: Element[]): Element[] {
  if (elements.length === 0) {
    return elements;
  }

  // filter out element which has its children covered
  const result: Element[] = [];
  elements.forEach((e) => {
    if (isExplicitlyRequested(e)) {
      result.push(e);
    } else {
      for (let j = 0; j < result.length; j++) {
        const r = result[j];
        if (r === undefined) {
          continue;
        }
        if (r.contains(e)) {
          if (r.tagName !== "A" || !(r as HTMLAnchorElement).href) {
            result[j] = e;
          }
          return;
        } else if (r.shadowRoot && r.shadowRoot.contains(e)) {
          // skip child from shadowRoot of a selected element.
          return;
        } else if (e.contains(r)) {
          console.log("skip: ", e, r);
          return;
        }
      }
      result.push(e);
    }
  });

  return result;
}

function getRealRect(elm: Element): DOMRect {
  if (elm.childElementCount === 0) {
    const r = elm.getClientRects();
    if (r.length === 3 && r[1] !== undefined) {
      // for a clipped A tag
      return r[1];
    } else if (r.length === 2 && r[0] !== undefined) {
      // for a wrapped A tag
      return r[0];
    } else {
      return elm.getBoundingClientRect();
    }
  } else if (elm.childElementCount === 1 && elm.firstElementChild!.textContent) {
    let r = elm.firstElementChild!.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) {
      r = elm.getBoundingClientRect();
    }
    return r;
  } else {
    return elm.getBoundingClientRect();
  }
}

function isExplicitlyRequested(element: Element): boolean {
  return !!runtime.conf.clickableSelector && element.matches(runtime.conf.clickableSelector);
}

function filterOverlapElements(elements: Element[]): Element[] {
  // filter out tiny elements
  elements = elements.filter((e) => {
    const be = getRealRect(e);
    const input = e as HTMLInputElement;
    if (input.disabled || input.readOnly || !isElementDrawn(e, be)) {
      return false;
    } else if (
      e.matches("input, textarea, select, form") ||
      (e as HTMLElement).contentEditable === "true" ||
      isExplicitlyRequested(e)
    ) {
      return true;
    } else {
      const root = e.getRootNode() as Document | ShadowRoot;
      const el = root.elementFromPoint(be.left + be.width / 2, be.top + be.height / 2);
      return (
        !el ||
        (el.shadowRoot && (el.childElementCount === 0 || el.shadowRoot.contains(e))) ||
        el.contains(e) ||
        e.contains(el)
      );
    }
  });

  return filterAncestors(elements);
}

/**
 * Get all clickable elements. SurfingKeys has its own logic to identify clickable elements, such as
 * a `HTMLAnchorElement` or elements with cursor as pointer. This function provides two parameters
 * to identify those clickable elements that SurfingKeys failed to identify.
 *
 * @example
 *   var elms = getClickableElements("[rel=link]", /click this/);
 *
 * @param {string} selectorString Extra css selector of those clickable elements.
 * @param {regex} pattern A regular expression that matches text of the clickable elements.
 * @returns {array} Array of clickable elements.
 */
function getClickableElements(selectorString: string, pattern?: RegExp): Element[] {
  const nodes = listElements<HTMLElement>(document.body, NodeFilter.SHOW_ELEMENT, (n) => {
    return !!(
      n.offsetHeight &&
      n.offsetWidth &&
      getComputedStyle(n).cursor === "pointer" &&
      (n.matches(selectorString) ||
        (pattern &&
          (pattern.test(n.textContent ?? "") || pattern.test(n.getAttribute("aria-label") ?? ""))))
    );
  });
  return filterOverlapElements(nodes);
}

function getTextNodes(root: Node, pattern: RegExp, flag?: number): Node[] | TreeWalker {
  const skip_tags = ["script", "style", "noscript", "surfingkeys_mark"];
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const text = node as Text;
      const parent = node.parentNode as HTMLElement | null;
      if (
        !text.data.trim() ||
        !parent ||
        !parent.offsetParent ||
        skip_tags.indexOf(parent.localName.toLowerCase()) !== -1 ||
        !pattern.test(text.data)
      ) {
        // node changed, reset pattern.lastIndex
        pattern.lastIndex = 0;
        return NodeFilter.FILTER_REJECT;
      }
      const br = parent.getBoundingClientRect();
      if (br.width < 4 || br.height < 4) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Node[] = [];
  if (flag === 1) {
    nodes.push(treeWalker.firstChild()!);
  } else if (flag === -1) {
    nodes.push(treeWalker.lastChild()!);
  } else if (flag === 0) {
    return treeWalker;
  } else if (flag === 2) {
    while (treeWalker.nextNode()) nodes.push(treeWalker.currentNode.parentNode!);
  } else {
    while (treeWalker.nextNode()) nodes.push(treeWalker.currentNode);
  }
  return nodes;
}

function getTextNodePos(
  node: Node,
  offset: number,
  length?: number,
): { left: number; top: number; width?: number; height?: number } {
  const selection = document.getSelection()!;
  selection.setBaseAndExtent(
    node,
    offset,
    node,
    length ? offset + length : (node as Text).data.length,
  );
  const br = selection.rangeCount > 0 ? selection.getRangeAt(0).getClientRects()[0] : null;
  const pos: { left: number; top: number; width?: number; height?: number } = {
    left: -1,
    top: -1,
  };
  if (br && br.height > 0 && br.width > 0) {
    pos.left = br.left;
    pos.top = br.top;
    pos.width = br.width;
    pos.height = br.height;
  }
  return pos;
}

const _focusedRange = document.createRange();
function getTextRect(
  node: Node,
  startOffset: number,
  endNodeOrOffset?: Node | number,
  endOffset?: number,
): DOMRectList | DOMRect[] {
  let rects: DOMRectList | DOMRect[] = [];
  try {
    let start = startOffset;
    while (rects.length === 0 && start >= 0) {
      _focusedRange.setStart(node, start);
      if (endOffset !== undefined) {
        _focusedRange.setEnd(endNodeOrOffset as Node, endOffset);
      } else if (endNodeOrOffset !== undefined) {
        _focusedRange.setEnd(node, endNodeOrOffset as number);
      } else {
        _focusedRange.setEnd(node, startOffset);
      }
      rects = _focusedRange.getClientRects();
      start--;
    }
  } catch {
    return [];
  }
  return rects;
}

function locateFocusNode(
  selection: Selection | null,
): { left: number; top: number; width: number; height: number } | null {
  const sel = selection!;
  const se = sel.focusNode!.parentElement!;
  scrollIntoViewIfNeeded(se, true);
  let r0 = getTextRect(sel.focusNode!, sel.focusOffset)[0];
  if (!r0) {
    r0 = (sel.focusNode as Element).getBoundingClientRect();
  }
  if (r0) {
    const r = {
      left: r0.left,
      top: r0.top,
      width: r0.width,
      height: r0.height,
    };
    if (r.left < 0 || r.left >= window.innerWidth) {
      se.scrollLeft += r.left - window.innerWidth / 2;
      r.left = window.innerWidth / 2;
    }
    if (r.top < 0 || r.top >= window.innerHeight) {
      se.scrollTop += r.top - window.innerHeight / 2;
      r.top = window.innerHeight / 2;
    }
    return r;
  }
  return null;
}

function getNearestWord(text: string, offset: number): [number, number] {
  let ret: [number, number] = [0, text.length];
  const nonWord = /\W/;
  if (offset < 0) {
    offset = 0;
  } else if (offset >= text.length) {
    offset = text.length - 1;
  }
  const at = (idx: number): string => text[idx] ?? "";
  let found = true;
  if (nonWord.test(at(offset))) {
    let delta = 0;
    found = false;
    while (!found && (offset > delta || offset + delta < text.length)) {
      delta++;
      found =
        (offset - delta >= 0 && !nonWord.test(at(offset - delta))) ||
        (offset + delta < text.length && !nonWord.test(at(offset + delta)));
    }
    offset =
      offset - delta >= 0 && !nonWord.test(at(offset - delta)) ? offset - delta : offset + delta;
  }
  if (found) {
    let start = offset,
      end = offset;
    while (start >= 0 && !nonWord.test(at(start))) {
      start--;
    }
    while (end < text.length && !nonWord.test(at(end))) {
      end++;
    }
    ret = [start + 1, end - start - 1];
  }
  return ret;
}

let _clickPos: [number, number] | null = null;
document.addEventListener("mousedown", (event) => {
  _clickPos = [event.clientX, event.clientY];
});
function getWordUnderCursor(mouseCursor?: boolean): string | null {
  const selection = document.getSelection()!;
  if (selection.focusNode && selection.focusNode.textContent) {
    const range = getNearestWord(selection.focusNode.textContent, selection.focusOffset);
    const selRect = getTextRect(selection.focusNode, range[0], range[0] + range[1])[0];
    const word = selection.focusNode.textContent.substr(range[0], range[1]);
    if (selRect && word) {
      if (!mouseCursor || (_clickPos && selRect.has(_clickPos[0], _clickPos[1], 0, 0))) {
        return word.trim();
      }
    }
  }
  return null;
}

DOMRect.prototype.has = function (x, y, ex, ey) {
  // allow some errors of x and y as ex and ey respectively.
  return y > this.top - ey && y < this.bottom + ey && x > this.left - ex && x < this.right + ex;
};

function initL10n(cb: (translate: (str: string) => string) => void): void {
  const lang = runtime.conf.language || window.navigator.language;
  if (lang === "en-US") {
    cb((str) => str);
  } else {
    fetch(browser.runtime.getURL("pages/l10n.json"))
      .then((res) => res.json())
      .then((l10n) => {
        if (typeof l10n[lang] === "object") {
          const table = l10n[lang];
          cb((str) => (table[str] ? table[str] : str));
        } else {
          cb((str) => str);
        }
      });
  }
}

String.prototype.format = function (...args: unknown[]): string {
  let formatted = String(this);
  for (let i = 0; i < args.length; i++) {
    const regexp = new RegExp("\\{" + i + "\\}", "gi");
    formatted = formatted.replace(regexp, String(args[i]));
  }
  return formatted;
};

String.prototype.reverse = function (): string {
  return this.split("").reverse().join("");
};

RegExp.prototype.toJSON = function () {
  return { source: this.source, flags: this.flags };
};

function parseAnnotation(ag: { annotation: string | string[]; feature_group?: number }): {
  annotation: string | string[];
  feature_group?: number;
} {
  let an: string | string[] = ag.annotation;
  if (an.constructor.name === "String") {
    // for parameterized annotations such as ["#6Search selected with {0}", "Google"]
    an = [an as string];
  }
  const arr = an as string[];
  const first = arr[0];
  if (first === undefined) {
    return ag;
  }
  const annotations = first.match(/^#(\d+)(.*)/);
  if (annotations !== null) {
    const featureGroup = annotations[1];
    const rest = annotations[2];
    if (featureGroup !== undefined && rest !== undefined) {
      ag.feature_group = parseInt(featureGroup);
      arr[0] = rest;
    }
  }
  // first element must not be ""
  const head = arr[0] ?? "";
  ag.annotation = head.length === 0 ? "" : arr;
  return ag;
}

function mapInMode(
  mode: { name: string; mappings: Trie },
  nks: string,
  oks: string,
  new_annotation?: string | string[],
): Trie | undefined {
  oks = KeyboardUtils.encodeKeystroke(oks);
  const old_map = mode.mappings.find(oks);
  if (old_map) {
    nks = KeyboardUtils.encodeKeystroke(nks);
    mode.mappings.remove(nks);
    // meta.word need to be new
    let meta = Object.assign({}, old_map.meta) as TrieMeta;
    if (new_annotation) {
      meta = Object.assign(meta, parseAnnotation({ annotation: new_annotation })) as TrieMeta;
    }
    mode.mappings.add(nks, meta);
    if (!isInUIFrame()) {
      dispatchSKEvent("front", ["addMapkey", mode.name, nks, oks]);
    }
  }
  return old_map;
}

function getAnnotations(mappings: Trie): {
  word: string;
  feature_group: number | undefined;
  annotation: string | string[] | undefined;
}[] {
  return mappings
    .getWords()
    .map((w) => {
      const meta = mappings.find(w)!.meta!;
      return {
        word: w,
        feature_group: meta.feature_group,
        annotation: meta.annotation,
      };
    })
    .filter((m) => m.annotation && m.annotation.length > 0);
}

function constructSearchURL(se: string, word: string): string {
  if (se.indexOf("{0}") > 0) {
    return se.format(word);
  } else if (se.indexOf("%s") > 0) {
    return se.replace("%s", word);
  } else {
    return se + word;
  }
}

/**
 * Open links in new tabs.
 *
 * @example
 *   tabOpenLink("https://github.com/brookhong/Surfingkeys");
 *
 * @param {string} str Links to be opened, the links should be split by `\n` if there are more than
 *   one.
 * @param {number} [simultaneousness=5] How many tabs will be opened simultaneously, the rest will
 *   be queued and opened later whenever a tab is closed. Default is `5`
 */
function tabOpenLink(str: string | string[] | NodeList, simultaneousness?: number): void {
  simultaneousness = simultaneousness || 5;

  let urls: string[];
  if (str.constructor.name === "Array") {
    urls = str as string[];
  } else if (str instanceof NodeList) {
    urls = Array.from(str).map((n) => (n as HTMLAnchorElement).href);
  } else {
    urls = (str as string).trim().split("\n");
  }

  urls = urls.map((u) => u.trim()).filter((u) => u.length > 0);

  if (urls.length > simultaneousness) {
    dispatchSKEvent("front", [
      "showDialog",
      `Do you really want to open all these ${urls.length} links?`,
      () => {
        // open the first batch links immediately
        urls.slice(0, simultaneousness).forEach((url) => {
          RUNTIME("openLink", {
            tab: {
              tabbed: true,
            },
            url: url,
          });
        });
        // queue the left for later opening when there is one tab closed.
        RUNTIME("queueURLs", {
          urls: urls.slice(simultaneousness),
        });
      },
    ]);
  } else {
    urls.forEach((url) => {
      RUNTIME("openLink", {
        tab: {
          tabbed: true,
        },
        url: url,
      });
    });
  }
}
////////////////////////////////////////////////////////////////////////////////

function filterInvisibleElements(nodes: HTMLElement[]): HTMLElement[] {
  return nodes.filter((n) => {
    return (
      n.offsetHeight &&
      n.offsetWidth &&
      !n.getAttribute("disabled") &&
      isElementPartiallyInViewport(n) &&
      getComputedStyle(n).visibility !== "hidden"
    );
  });
}

function setSanitizedContent(elm: Element, str: string): void {
  elm.innerHTML = DOMPurify.sanitize(str);
}

function createElementWithContent(
  tag: string,
  content?: string,
  attributes?: Record<string, string>,
): HTMLElement {
  const elm = document.createElement(tag);
  if (content) {
    setSanitizedContent(elm, content);
  }

  if (attributes) {
    for (const attr in attributes) {
      const val = attributes[attr];
      if (val !== undefined) {
        elm.setAttribute(attr, val);
      }
    }
  }

  return elm;
}

const _divForHtmlEncoder = document.createElement("div");
function htmlEncode(str: string): string {
  _divForHtmlEncoder.innerText = str;
  return _divForHtmlEncoder.innerHTML;
}

HTMLElement.prototype.one = function (evt, handler) {
  const self = this;
  function _onceHandler(this: HTMLElement) {
    handler.call(this);
    self.removeEventListener(evt, _onceHandler);
  }
  this.addEventListener(evt, _onceHandler);
};

HTMLElement.prototype.show = function () {
  this.style.display = "";
};

HTMLElement.prototype.hide = function () {
  this.style.display = "none";
};

HTMLElement.prototype.removeAttributes = function () {
  while (this.attributes.length > 0) {
    const first = this.attributes[0];
    if (first === undefined) {
      break;
    }
    this.removeAttribute(first.name);
  }
};
HTMLElement.prototype.containsWithShadow = function (e) {
  const roots: Element[] = [this];
  while (roots.length) {
    const root = roots.shift()!;
    if (root.contains(e)) {
      return true;
    }
    roots.push(...root.children);
    if (root.shadowRoot) {
      if (root.shadowRoot.contains(e)) {
        return true;
      }
      roots.push(...root.shadowRoot.children);
    }
  }
  return false;
};

NodeList.prototype.remove = function () {
  this.forEach((node) => {
    (node as ChildNode).remove();
  });
};
NodeList.prototype.show = function () {
  this.forEach((node) => {
    (node as HTMLElement).show();
  });
};
NodeList.prototype.hide = function () {
  this.forEach((node) => {
    (node as HTMLElement).hide();
  });
};

function httpRequest(args: Record<string, unknown>, onSuccess: (response: any) => void): void {
  args["method"] = "get";
  RUNTIME("request", args, onSuccess);
}

const flashElem = createElementWithContent("div", "", {
  style:
    "position: fixed; box-shadow: 0px 0px 4px 2px #63b2ff; background: transparent; z-index: 2140000000",
});
function flashPressedLink(link: Element, cb: () => void): void {
  const rect = getRealRect(link);
  flashElem.style.left = rect.left + "px";
  flashElem.style.top = rect.top + "px";
  flashElem.style.width = rect.width + "px";
  flashElem.style.height = rect.height + "px";
  document.body.appendChild(flashElem);

  setTimeout(() => {
    flashElem.remove();
    cb();
  }, 100);
}

function safeDecodeURI(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

function safeDecodeURIComponent(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function getCssSelectorsOfEditable(): string {
  return "input:not([type=submit]), textarea, *[contenteditable=true], *[role=textbox], select, div.ace_cursor";
}

type Hint = HTMLElement & { label: string; link: unknown };

function refreshHints(
  hints: ArrayLike<Hint> & Iterable<Hint>,
  pressedKeys: string,
): { candidates: number; matched?: unknown } {
  const result: { candidates: number; matched?: unknown } = { candidates: 0 };
  if (pressedKeys.length > 0) {
    for (const hint of hints) {
      const label = hint.label;
      if (pressedKeys === label) {
        result.matched = hint.link;
        break;
      } else if (label.indexOf(pressedKeys) === 0) {
        hint.style.opacity = "1";
        setSanitizedContent(
          hint,
          `<span style="opacity: 0.2;">${pressedKeys}</span>` + label.substr(pressedKeys.length),
        );
        result.candidates++;
      } else {
        hint.style.opacity = "0";
      }
    }
  } else {
    if (hints.length === 1 && hints[0] !== undefined) {
      result.matched = hints[0].link;
    } else {
      for (const hint of hints) {
        hint.style.opacity = "1";
        setSanitizedContent(hint, hint.label);
      }
      result.candidates = hints.length;
    }
  }
  return result;
}

function rotateInput(
  inputs: string[],
  backward: boolean,
  curr: number,
  str?: string,
): [string | undefined, number] {
  let list = inputs;
  if (str) {
    list = inputs.filter((l) => l.indexOf(str) === 0 && l !== str);
    if (curr > list.length) {
      curr = list.length;
    }
  }
  const delta = backward ? -1 : 1;
  const length = list.length + 1; // +1 for empty input
  curr = (curr + length + delta) % length;
  return [curr < list.length ? list[curr] : str, curr];
}

function attachFaviconToImgSrc(
  tab: { url: string; favIconUrl?: string },
  imgEl: HTMLImageElement,
): void {
  const browserName = getBrowserName();
  if (browserName === "Chrome") {
    imgEl.src = browser.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(tab.url)}`);
  } else {
    imgEl.src = tab.favIconUrl ?? "";
  }
}

export {
  actionWithSelectionPreserved,
  applyUserSettings,
  attachFaviconToImgSrc,
  constructSearchURL,
  createElementWithContent,
  dispatchMouseEvent,
  filterAncestors,
  filterInvisibleElements,
  filterOverlapElements,
  flashPressedLink,
  generateQuickGuid,
  getAnnotations,
  getBrowserName,
  getClickableElements,
  getColor,
  getCssSelectorsOfEditable,
  getDocumentOrigin,
  getLargeElements,
  getRealEdit,
  getRealRect,
  getTextNodePos,
  getTextNodes,
  getTextRect,
  getVisibleElements,
  getWordUnderCursor,
  htmlEncode,
  httpRequest,
  initL10n,
  initSKFunctionListener,
  isEditable,
  isElementClickable,
  isElementDrawn,
  isElementPartiallyInViewport,
  isInUIFrame,
  listElements,
  locateFocusNode,
  mapInMode,
  parseAnnotation,
  refreshHints,
  reportIssue,
  rotateInput,
  safeDecodeURI,
  safeDecodeURIComponent,
  scrollIntoViewIfNeeded,
  setSanitizedContent,
  showBanner,
  showPopup,
  tabOpenLink,
  timeStampString,
  toggleQuote,
};
