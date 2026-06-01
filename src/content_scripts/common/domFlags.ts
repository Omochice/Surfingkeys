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

const newlyCreatedElements = new WeakSet<Element>();

/**
 * Flag an element as newly inserted into the page, so normal mode steals focus from it on the next
 * keystroke (set by the mutation observer).
 *
 * @param element The freshly inserted element.
 */
export function markNewlyCreated(element: Element): void {
  newlyCreatedElements.add(element);
}

/**
 * Whether the element is flagged as newly inserted via {@link markNewlyCreated}.
 *
 * @param element The element to test.
 * @returns `true` while the element is still flagged as newly created.
 */
export function isNewlyCreated(element: Element): boolean {
  return newlyCreatedElements.has(element);
}

/**
 * Clear the newly-created flag once focus has been stolen, so the element is treated normally
 * afterwards.
 *
 * @param element The element to clear.
 */
export function unmarkNewlyCreated(element: Element): void {
  newlyCreatedElements.delete(element);
}

const surfingKeysElements = new WeakSet<Element>();

/**
 * Mark an element as injected by Surfingkeys, so the scroll observer ignores it instead of treating
 * it as a newly inserted page node.
 *
 * @param element The Surfingkeys-injected element.
 */
export function markSurfingKeysElement(element: Element): void {
  surfingKeysElements.add(element);
}

/**
 * Whether the element was injected by Surfingkeys (see {@link markSurfingKeysElement}).
 *
 * @param element The element to test.
 * @returns `true` when the element is a Surfingkeys-injected node.
 */
export function isSurfingKeysElement(element: Element): boolean {
  return surfingKeysElements.has(element);
}
