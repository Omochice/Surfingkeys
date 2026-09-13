// `front`/`api`/`user`/`hints`/`observer` are function-listener namespaces; the rest are one-off
// lifecycle events listened to directly.
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
