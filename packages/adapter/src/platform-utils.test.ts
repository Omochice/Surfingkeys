import { conf } from "@sk/core/conf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { attachFaviconToImgSrc, initL10n } from "./platform-utils";

describe("initL10n", () => {
  const originalLanguage = conf.language;

  afterEach(() => {
    conf.language = originalLanguage;
    vi.unstubAllGlobals();
  });

  it("calls cb with the identity translator when fetch rejects (network error)", async () => {
    conf.language = "ja";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    // Wrap the callback in a Promise so the test can await the async chain settling.
    const result = await new Promise<string>((resolve) => {
      initL10n((translate) => resolve(translate("hello")));
    });

    expect(result).toBe("hello");
  });

  it("calls cb with the identity translator when the JSON response is malformed", async () => {
    conf.language = "ja";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => {
          throw new SyntaxError("bad JSON");
        },
      })),
    );

    const result = await new Promise<string>((resolve) => {
      initL10n((translate) => resolve(translate("hello")));
    });

    expect(result).toBe("hello");
  });
});

// attachFaviconToImgSrc branches on navigator.userAgent, the seam that tells
// Chrome from Firefox. Override it per-test and restore after.
describe("attachFaviconToImgSrc", () => {
  const original = window.navigator.userAgent;
  const setUserAgent = (value: string) => {
    Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
  };
  afterEach(() => setUserAgent(original));

  it("uses the chrome favicon endpoint on Chrome", () => {
    setUserAgent("Chrome/120.0");
    const img = document.createElement("img");
    attachFaviconToImgSrc({ url: "https://example.com/p" }, img);
    expect(img.getAttribute("src")).toBe(
      "/_favicon/?pageUrl=" + encodeURIComponent("https://example.com/p"),
    );
  });

  it("uses the tab favIconUrl on Firefox", () => {
    setUserAgent("Firefox/120.0");
    const img = document.createElement("img");
    attachFaviconToImgSrc(
      { url: "https://example.com/p", favIconUrl: "https://example.com/f.ico" },
      img,
    );
    expect(img.getAttribute("src")).toBe("https://example.com/f.ico");
  });

  it("sets src to empty string when favIconUrl is absent on Firefox", () => {
    setUserAgent("Firefox/120.0");
    const img = document.createElement("img");
    // favIconUrl is intentionally omitted to exercise the `?? ""` fallback.
    attachFaviconToImgSrc({ url: "https://example.com/" }, img);
    expect(img.getAttribute("src")).toBe("");
  });
});
