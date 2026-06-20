// Pure-DOM ambient augmentations shared by every package program that compiles source touching
// these globals. Each package's tsconfig lists this file in `include` (ambient script .d.ts are
// not pulled in by following module imports, only by a program's own include/files). It contains
// no chrome/WebExtension types, so @sk/core can include it while keeping `types: []`.
//
// Ambient declaration-merging onto built-in interfaces must use `interface`; the oxlint
// `typescript/consistent-type-definitions` rule is disabled for this file via .oxlintrc.json.

declare global {
  interface Element {
    /** Non-standard WebKit/Blink method; absent on Firefox, hence optional. */
    scrollIntoViewIfNeeded?(centerIfNeeded?: boolean): void;
    /**
     * Sanitizing HTML Sanitizer API. The bundled lib.dom.d.ts (TypeScript 6.0.3) ships only the
     * non-sanitizing `setHTMLUnsafe`, so the safe variant we rely on to replace DOMPurify is
     * declared here until the lib catches up.
     */
    setHTML(html: string, options?: SetHTMLOptions): void;
  }
  /**
   * Minimal options bag for {@link Element.setHTML}. Only the `sanitizer` config we pass is
   * declared; the full Sanitizer API surface is omitted until lib.dom.d.ts ships it.
   */
  interface SetHTMLOptions {
    sanitizer?: { removeAttributes?: string[] };
  }
  interface Event {
    sk_keyName?: string;
    sk_stopPropagation?: boolean;
    sk_suppressed?: boolean;
  }
  interface Document {
    /** Set by the Dictorium extension when its dictionary integration is active. */
    dictEnabled?: boolean;
  }
  interface Window {
    frameId?: string;
    getFrameId(): string | undefined;
    /** Non-standard text search; omitted from the lib DOM types. */
    find(
      aString: string,
      caseSensitive?: boolean,
      backwards?: boolean,
      wrapAround?: boolean,
      wholeWord?: boolean,
    ): boolean;
  }
}

export {};
