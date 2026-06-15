import { afterEach, describe, expect, it, vi } from "vitest";

import createUiHost from "./uiframe";

// createUiHost reaches the extension URL through the browser polyfill, which is
// absent under jsdom; stub just the getURL the host needs to build the iframe.
vi.mock("@sk/adapter/browser", () => ({
  default: { runtime: { getURL: (path: string) => path } },
}));

afterEach(() => {
  // Each createUiHost appends a host div to <html>; drop them so the next test
  // boots in isolation and lastElementChild points at its own host.
  document.documentElement.querySelectorAll(":scope > div").forEach((d) => d.remove());
});

/**
 * `onWindowMessage` is only exposed by being registered as a capture-phase window "message"
 * listener inside the iframe's load handler. Boot the host, drive the load event, and capture that
 * listener so a test can invoke it directly with a crafted event.
 */
function bootMessageHandler(): (event: MessageEvent) => void {
  let captured: ((event: MessageEvent) => void) | undefined;
  const origAdd = window.addEventListener.bind(window);
  const spy = vi
    .spyOn(window, "addEventListener")
    .mockImplementation((type: string, listener: any, opts?: any) => {
      if (type === "message" && opts === true) {
        captured = listener as (event: MessageEvent) => void;
        return;
      }
      origAdd(type, listener, opts);
    });
  createUiHost({}, vi.fn());
  const host = document.documentElement.lastElementChild as HTMLElement;
  const ifr = host.shadowRoot!.querySelector("iframe")!;
  // jsdom gives a shadow-DOM iframe no browsing context, so the load handler's
  // contentWindow is null; stub the postMessage it sends the initial frame to.
  Object.defineProperty(ifr, "contentWindow", {
    value: { postMessage: vi.fn() },
    configurable: true,
  });
  ifr.dispatchEvent(new Event("load"));
  spy.mockRestore();
  if (!captured) {
    throw new Error("window message handler was not captured");
  }
  return captured;
}

function fakeEvent(data: unknown, source: { postMessage: (...args: any[]) => void }): MessageEvent {
  return {
    data,
    source,
    timeStamp: 0,
    stopImmediatePropagation: () => {},
  } as unknown as MessageEvent;
}

describe("createUiHost window message handler — activeContent origin", () => {
  it("does not activate the content window when a forwarded message lacks an origin", () => {
    const onMessage = bootMessageHandler();
    const source = { postMessage: vi.fn() };

    onMessage(
      fakeEvent({ surfingkeys_uihost_data: { toFrontend: true, action: "showStatus" } }, source),
    );

    // A missing origin is not a valid postMessage targetOrigin, so the
    // activeContent branch must be skipped rather than posting to the content
    // window with an empty origin (which throws a DOMException).
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it("activates the content window when the forwarded message carries an origin", () => {
    const onMessage = bootMessageHandler();
    const source = { postMessage: vi.fn() };

    onMessage(
      fakeEvent(
        {
          surfingkeys_uihost_data: {
            toFrontend: true,
            action: "showStatus",
            origin: "https://example.com",
          },
        },
        source,
      ),
    );

    expect(source.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        surfingkeys_content_data: expect.objectContaining({ action: "activated" }),
      }),
      "https://example.com",
    );
  });
});
