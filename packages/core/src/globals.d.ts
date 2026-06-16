// The engine flags key events as it processes them; these properties form the
// key-handling protocol the engine shares with the UI surfaces that re-dispatch
// events. They live here, in the engine that owns the protocol, rather than in
// the extension shell so `@sk/core` type-checks without the WebExtension types.
//
// Ambient declaration-merging onto built-in interfaces must use `interface`;
// the oxlint `typescript/consistent-type-definitions` rule is disabled for
// globals.d.ts via overrides in .oxlintrc.json.

declare global {
  interface Event {
    sk_keyName?: string;
    sk_stopPropagation?: boolean;
    sk_suppressed?: boolean;
  }
}

export {};
