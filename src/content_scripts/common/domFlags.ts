// Per-element flags Surfingkeys used to store as DOM expandos are kept in
// WeakSet side-tables instead, so the extension never mutates page-owned nodes
// and the entries are reclaimed with their elements.

const autoFocusElements = new WeakSet<Element>();

/**
 * Mark an element as exempt from normal mode's auto-focus suppression, so a focus event targeting
 * it is not blurred away (used by the clipboard holder).
 *
 * @param element The element to exempt from auto-focus suppression.
 */
export function markAutoFocus(element: Element): void {
  autoFocusElements.add(element);
}

/**
 * Whether the element was registered via {@link markAutoFocus}.
 *
 * @param element The element to test.
 * @returns `true` when the element is exempt from auto-focus suppression.
 */
export function isAutoFocusMarked(element: Element): boolean {
  return autoFocusElements.has(element);
}
