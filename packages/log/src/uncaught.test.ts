import { describe, expect, it, vi } from "vitest";

import { captureUncaught } from "./uncaught";

/**
 * Builds the event an uncaught error surfaces as. ErrorEvent and PromiseRejectionEvent are browser
 * classes absent from the node environment these tests run in, so the fields the listeners read are
 * attached to a plain Event instead.
 */
function errorEvent(fields: { error?: unknown; message?: string; filename?: string }): Event {
  return Object.assign(new Event("error"), fields);
}

function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event("unhandledrejection"), { reason });
}

describe("captureUncaught", () => {
  it("logs an uncaught error at the error level", () => {
    const target = new EventTarget();
    const log = vi.fn();
    const cause = new Error("boom");
    captureUncaught(target, log);

    target.dispatchEvent(errorEvent({ error: cause, message: "Uncaught Error: boom" }));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Uncaught error:", cause);
  });

  it("falls back to the event message when no error object is attached", () => {
    const target = new EventTarget();
    const log = vi.fn();
    captureUncaught(target, log);

    target.dispatchEvent(errorEvent({ message: "Script error." }));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Uncaught error:", "Script error.");
  });

  it("logs the reason of an unhandled rejection", () => {
    const target = new EventTarget();
    const log = vi.fn();
    const reason = new Error("rejected");
    captureUncaught(target, log);

    target.dispatchEvent(rejectionEvent(reason));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Unhandled rejection:", reason);
  });

  it("reports a rejection whose reason is not an Error", () => {
    const target = new EventTarget();
    const log = vi.fn();
    captureUncaught(target, log);

    target.dispatchEvent(rejectionEvent("nope"));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Unhandled rejection:", "nope");
  });

  it("reports an error from any script when no origin is given", () => {
    const target = new EventTarget();
    const log = vi.fn();
    const cause = new Error("boom");
    captureUncaught(target, log);

    target.dispatchEvent(errorEvent({ error: cause, filename: "https://example.com/app.js" }));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Uncaught error:", cause);
  });

  it("stops reporting once the returned disposer has run", () => {
    const target = new EventTarget();
    const log = vi.fn();
    const dispose = captureUncaught(target, log);

    dispose();
    target.dispatchEvent(errorEvent({ error: new Error("boom") }));
    target.dispatchEvent(rejectionEvent(new Error("rejected")));

    expect(log).not.toHaveBeenCalled();
  });
});

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnop/";

/** An error carrying a stack, which is what the origin filter reads when no filename is present. */
function errorWithStack(stack: string): Error {
  const error = new Error("boom");
  error.stack = stack;
  return error;
}

describe("captureUncaught with an origin", () => {
  it("drops an error raised by a script of the visited page", () => {
    const target = new EventTarget();
    const log = vi.fn();
    captureUncaught(target, log, { origin: EXTENSION_ORIGIN });

    target.dispatchEvent(
      errorEvent({
        error: errorWithStack("Error: boom\n    at https://example.com/app.js:1:1"),
        filename: "https://example.com/app.js",
      }),
    );

    expect(log).not.toHaveBeenCalled();
  });

  it("reports an error whose filename is inside the extension", () => {
    const target = new EventTarget();
    const log = vi.fn();
    const cause = errorWithStack("Error: boom\n    at somewhere");
    captureUncaught(target, log, { origin: EXTENSION_ORIGIN });

    target.dispatchEvent(
      errorEvent({ error: cause, filename: `${EXTENSION_ORIGIN}content-scripts/content.js` }),
    );

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Uncaught error:", cause);
  });

  it("reports a filename-less error whose stack points inside the extension", () => {
    const target = new EventTarget();
    const log = vi.fn();
    const cause = errorWithStack(`Error: boom\n    at ${EXTENSION_ORIGIN}background.js:9:1`);
    captureUncaught(target, log, { origin: EXTENSION_ORIGIN });

    target.dispatchEvent(errorEvent({ error: cause }));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Uncaught error:", cause);
  });

  it("reports a rejection whose reason was raised inside the extension", () => {
    const target = new EventTarget();
    const log = vi.fn();
    const reason = errorWithStack(`Error: boom\n    at ${EXTENSION_ORIGIN}content.js:3:7`);
    captureUncaught(target, log, { origin: EXTENSION_ORIGIN });

    target.dispatchEvent(rejectionEvent(reason));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Unhandled rejection:", reason);
  });

  it("drops a rejection whose reason carries no stack to attribute it by", () => {
    const target = new EventTarget();
    const log = vi.fn();
    captureUncaught(target, log, { origin: EXTENSION_ORIGIN });

    target.dispatchEvent(rejectionEvent("nope"));

    expect(log).not.toHaveBeenCalled();
  });

  it("drops an error with neither a filename nor a stack", () => {
    const target = new EventTarget();
    const log = vi.fn();
    captureUncaught(target, log, { origin: EXTENSION_ORIGIN });

    target.dispatchEvent(errorEvent({ message: "Script error." }));

    expect(log).not.toHaveBeenCalled();
  });

  it("treats an empty filename as absent and falls back to the stack", () => {
    const target = new EventTarget();
    const log = vi.fn();
    const cause = errorWithStack(`Error: boom\n    at ${EXTENSION_ORIGIN}content.js:3:7`);
    captureUncaught(target, log, { origin: EXTENSION_ORIGIN });

    target.dispatchEvent(errorEvent({ error: cause, filename: "" }));

    expect(log).toHaveBeenCalledExactlyOnceWith("error", "Uncaught error:", cause);
  });
});
