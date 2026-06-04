// Ambient declaration-merging onto built-in interfaces must use `interface`;
// the oxlint `typescript/consistent-type-definitions` rule is disabled for
// this file via overrides in .oxlintrc.json.

declare global {
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
  }
}

export {};
