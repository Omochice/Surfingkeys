import { DEV_LOG_ACTION } from "@sk/log/relay";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enableDevLogging } from "./devLogging";

type StorageGet = (keys: string[], cb: (items: any) => void) => void;
const g = globalThis as unknown as {
  chrome: {
    runtime: {
      sendMessage: (message: unknown, cb?: () => void) => void;
      getURL: (path: string) => string;
    };
    storage: { local: { get: StorageGet } };
  };
};
const defaultGet = g.chrome.storage.local.get;
const defaultSendMessage = g.chrome.runtime.sendMessage;
const defaultGetURL = g.chrome.runtime.getURL;

// The shared stub resolves getURL to the path it is given, so getURL("") would be "" and every
// filename would match its prefix. A realistic extension origin keeps the filter under test.
const EXTENSION_ORIGIN = "chrome-extension://test-extension/";

// The level gate is decided behind an asynchronous storage read, so assertions must let pending
// continuations run before inspecting what was sent.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  g.chrome.storage.local.get = vi.fn((_keys: string[], cb: (items: any) => void) =>
    cb({ logLevels: ["log", "warn", "error"] }),
  );
  sendMessage = vi.fn();
  g.chrome.runtime.sendMessage = sendMessage;
  g.chrome.runtime.getURL = (path: string) => `${EXTENSION_ORIGIN}${path}`;
  // The console sink stays attached alongside the relay; silence it to keep the test output clean.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  g.chrome.storage.local.get = defaultGet;
  g.chrome.runtime.sendMessage = defaultSendMessage;
  g.chrome.runtime.getURL = defaultGetURL;
  vi.restoreAllMocks();
});

/** The single relayed envelope sent to the background. */
function relayed(): any {
  return sendMessage.mock.calls[0]?.[0];
}

describe("enableDevLogging", () => {
  it("relays every logged record to the background under the given context", async () => {
    const dispose = enableDevLogging("content");

    const { LOG } = await import("./log");
    LOG("warn", "careful");
    await flush();

    expect(relayed()).toStrictEqual({
      action: DEV_LOG_ACTION,
      context: "content",
      level: "warn",
      args: ["careful"],
    });
    dispose();
  });

  it("flattens an Error argument, which the message boundary would otherwise empty", async () => {
    const dispose = enableDevLogging("content");
    const cause = new TypeError("boom");
    cause.stack = "TypeError: boom\n    at somewhere";

    const { LOG } = await import("./log");
    LOG("error", "Failed:", cause);
    await flush();

    expect(relayed().args).toStrictEqual([
      "Failed:",
      { name: "TypeError", message: "boom", stack: "TypeError: boom\n    at somewhere" },
    ]);
    dispose();
  });

  it("relays an uncaught error raised by the extension's own script", async () => {
    const dispose = enableDevLogging("content");
    const cause = new Error("boom");
    cause.stack = `Error: boom\n    at ${EXTENSION_ORIGIN}content-scripts/content.js:1:1`;

    window.dispatchEvent(Object.assign(new Event("error"), { error: cause }));
    await flush();

    expect(relayed().args[0]).toBe("Uncaught error:");
    expect(relayed().args[1]).toStrictEqual(
      expect.objectContaining({ name: "Error", message: "boom" }),
    );
    dispose();
  });

  it("ignores a rejection raised by the visited page, whose events the isolated world also sees", async () => {
    const dispose = enableDevLogging("content");
    const pageError = new Error("their bug");
    pageError.stack = "Error: their bug\n    at https://example.com/app.js:1:1";

    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: pageError }));
    await flush();

    expect(sendMessage).not.toHaveBeenCalled();
    dispose();
  });

  it("swallows a send that throws, so a torn-down background stays invisible", async () => {
    sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });
    const dispose = enableDevLogging("content");

    const { LOG } = await import("./log");
    expect(() => LOG("error", "boom")).not.toThrow();
    await flush();

    dispose();
  });

  it("stops relaying once the returned disposer has run", async () => {
    const dispose = enableDevLogging("content");

    dispose();
    const { LOG } = await import("./log");
    LOG("error", "boom");
    // A rejection rather than an error event: an unhandled "error" event on the window is reported
    // by jsdom as a genuine test failure once this listener is gone.
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "nope" }));
    await flush();

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
