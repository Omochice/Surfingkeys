/**
 * Custom-event channels dispatched as `surfingkeys:<type>` for content↔frontend communication.
 * `front`/`api`/`user`/`hints`/`observer` are the registered {@link initSKFunctionListener}
 * namespaces; the rest are one-off lifecycle events listened to directly.
 */
type SKEventType =
  | "front"
  | "api"
  | "user"
  | "hints"
  | "observer"
  | "userSettingsLoaded"
  | "settingsFromSnippetsLoaded"
  | "iframeBoot"
  | "ensureFrontEnd"
  | "defaultSettingsLoaded";

function dispatchSKEvent(type: SKEventType, args?: unknown, target: EventTarget = document): void {
  target.dispatchEvent(new CustomEvent(`surfingkeys:${type}`, { detail: args }));
}

export { dispatchSKEvent };
