// Typed, cross-browser (Chrome MV3 + Firefox) extension API, via
// webextension-polyfill. This is the single seam through which the WebExtension
// API enters the content scripts; it replaces the per-file `declare const
// chrome` blocks. Promise-based — callback-style call sites stay on the
// messaging layer (common/runtime.ts) until they are migrated deliberately.
import browser from "webextension-polyfill";

export default browser;
