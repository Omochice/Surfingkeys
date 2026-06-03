// Ambient declaration-merging onto built-in interfaces must use `interface`;
// the oxlint `typescript/consistent-type-definitions` rule is disabled for
// this file via overrides in .oxlintrc.json.

declare global {
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
  }
}

export {};
