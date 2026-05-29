import { describe, expect, it } from "vitest";

import browser from "./browser";

// The BrowserAdapter wraps the WebExtension API (the chrome stub from setup.ts
// under jsdom). These pin the synchronous surface the content scripts rely on.
describe("BrowserAdapter", () => {
  it("exposes runtime.getURL returning the resolved path", () => {
    expect(typeof browser.runtime.getURL).toBe("function");
    expect(browser.runtime.getURL("pages/x.html")).toBe("pages/x.html");
  });

  it("exposes runtime.getManifest", () => {
    expect(typeof browser.runtime.getManifest).toBe("function");
    expect(browser.runtime.getManifest().manifest_version).toBe(3);
  });
});
