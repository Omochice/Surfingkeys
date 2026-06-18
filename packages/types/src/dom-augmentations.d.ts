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
