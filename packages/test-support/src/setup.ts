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
