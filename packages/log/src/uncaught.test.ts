import { describe, expect, it, vi } from "vitest";

import { captureUncaught } from "./uncaught";

/**
 * Builds the event an uncaught error surfaces as. ErrorEvent and PromiseRejectionEvent are browser
 * classes absent from the node environment these tests run in, so the fields the listeners read are
 * attached to a plain Event instead.
 */
function errorEvent(fields: { error?: unknown; message?: string }): Event {
  return Object.assign(new Event("error"), fields);
}

/** The rejection counterpart of {@link errorEvent}. */
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
