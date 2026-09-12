/// <reference types="vite/client" />

// The frontend iframe is its own document and needs its own relay; the guard sits beside the page's
// boot module in the HTML rather than inside it because that module is shared with the tests.
if (import.meta.env.DEV) {
  void import("@sk/adapter/devLogging").then(({ enableDevLogging }) => {
    enableDevLogging("frontend");
  });
}
