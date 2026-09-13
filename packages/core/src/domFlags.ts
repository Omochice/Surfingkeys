// Per-element flags Surfingkeys used to store as DOM expandos are kept in
// WeakSet side-tables instead, so the extension never mutates page-owned nodes
// and the entries are reclaimed with their elements.

const autoFocusElements = new WeakSet<Element>();

/** Exempt an element from normal mode's auto-focus suppression. */
export function markAutoFocus(element: Element): void {
  autoFocusElements.add(element);
}

/** Whether the element is exempt from auto-focus suppression. */
export function isAutoFocusMarked(element: Element): boolean {
  return autoFocusElements.has(element);
}

const newlyCreatedElements = new WeakSet<Element>();

/**
 * Flag an element as newly inserted into the page, so normal mode steals focus from it on the next
 * keystroke.
 */
export function markNewlyCreated(element: Element): void {
  newlyCreatedElements.add(element);
}

/** Whether the element is still flagged as newly inserted. */
export function isNewlyCreated(element: Element): boolean {
  return newlyCreatedElements.has(element);
}

/** Clear the newly-inserted flag. */
export function unmarkNewlyCreated(element: Element): void {
  newlyCreatedElements.delete(element);
}

const surfingKeysElements = new WeakSet<Element>();

/** Mark an element as injected by Surfingkeys rather than owned by the page. */
export function markSurfingKeysElement(element: Element): void {
  surfingKeysElements.add(element);
}

/** Whether the element was injected by Surfingkeys. */
export function isSurfingKeysElement(element: Element): boolean {
  return surfingKeysElements.has(element);
}
