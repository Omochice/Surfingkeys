/// <reference types="vite/client" />

// The frontend iframe is its own document, so it needs the relay the content script sets up for
// itself. The page's boot module in @sk/content is shared with the tests, which is why this guard
// sits beside it in the HTML rather than inside it.
if (import.meta.env.DEV) {
  void import("@sk/adapter/devLogging").then(({ enableDevLogging }) => {
    enableDevLogging("frontend");
  });
}
