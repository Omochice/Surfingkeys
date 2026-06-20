import DOMPurify from "dompurify";

// Minimal WebExtension API stub so content-script modules, which touch
// `chrome.*` at import time (e.g. runtime.js registers an onMessage listener),
// can be imported under jsdom. Tests that need specific behaviour should
// override individual members with vi.fn().
const noop = (): void => {};

const chromeStub = {
  runtime: {
    id: "test-extension",
    sendMessage: noop,
    connect: () => ({
      onMessage: { addListener: noop },
      onDisconnect: { addListener: noop },
      postMessage: noop,
    }),
    onMessage: { addListener: noop, removeListener: noop },
    getURL: (path: string) => path,
    getManifest: () => ({ version: "0.0.0", manifest_version: 3 }),
    lastError: undefined,
  },
  storage: {
    local: { get: noop, set: noop, remove: noop },
    sync: { get: noop, set: noop, remove: noop },
  },
};

(globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;

// jsdom implements neither Element.setHTML nor the Sanitizer API that backs it,
// so production code injecting markup through the sanitizing parser would throw
// under tests. Shim it with DOMPurify (the Element.setHTML type comes from the
// shared @sk/types augmentation) so the sanitization the helper promises
// (stripping scripts and event-handler attributes) stays exercised in CI even
// though the real browser API does that work in production.
if (typeof Element.prototype.setHTML !== "function") {
  Element.prototype.setHTML = function setHTML(this: Element, html: string): void {
    this.innerHTML = DOMPurify.sanitize(html);
  };
}
