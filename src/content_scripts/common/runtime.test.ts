import { Result } from "@praha/byethrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportError } from "./report";
import { dispatchSKEvent, RUNTIME, RUNTIMEAsync, runtime } from "./runtime";

// `reportError` is the presentation pipeline for chrome-runtime failures; async
// lastError failures (which Result.try's synchronous catch cannot see) must be
// routed through it instead of reaching the user callback with undefined.
vi.mock("./report", () => ({ reportError: vi.fn() }));

const reportErrorMock = vi.mocked(reportError);

// @types/chrome types lastError as a read-only getter and sendMessage as a
// promise-returning overload set; the test stub deliberately mutates lastError
// and supplies a synchronous callback-invoking mock, so it accesses the runtime
// through a loosened view rather than fighting the production types.
const runtimeStub = chrome.runtime as unknown as {
  lastError: { message: string } | undefined;
  sendMessage: (msg: unknown, cb?: (response: unknown) => void) => void;
};

afterEach(() => {
  // setup.ts seeds lastError as undefined; restore it so a failing test does
  // not leak the error state into sibling tests sharing the chrome stub.
  runtimeStub.lastError = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("RUNTIME", () => {
  it("invokes the user callback with the response when no lastError is set", () => {
    const response = { ok: true };
    runtimeStub.sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => {
      cb?.(response);
    });
    const userCallback = vi.fn();

    const result = RUNTIME("getTabs", null, userCallback);

    expect(Result.isSuccess(result)).toBe(true);
    expect(userCallback).toHaveBeenCalledWith(response);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("routes an async lastError through reportError instead of calling back with undefined", () => {
    runtimeStub.lastError = { message: "Could not establish connection." };
    runtimeStub.sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => {
      cb?.(undefined);
    });
    const userCallback = vi.fn();

    RUNTIME("getTabs", null, userCallback);

    expect(userCallback).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "chrome-runtime",
        op: "sendMessage:getTabs",
        cause: "Could not establish connection.",
      }),
    );
  });

  it("returns a Failure when sendMessage throws synchronously", () => {
    runtimeStub.sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });

    const result = RUNTIME("getTabs", null, vi.fn());

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.error).toMatchObject({ kind: "chrome-runtime", op: "sendMessage:getTabs" });
    }
  });

  it("forwards repeats to the background and resets RUNTIME.repeats for a background-repeat action", () => {
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown) => {
      sent = msg;
    });
    RUNTIME.repeats = 5;

    RUNTIME("closeTab");

    // The background-repeat branch copies repeats into the message then resets
    // the foreground counter to 1.
    expect(sent.repeats).toBe(5);
    expect(RUNTIME.repeats).toBe(1);
  });

  it("does not attach a repeats field for a non-background-repeat action", () => {
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown) => {
      sent = msg;
    });
    RUNTIME.repeats = 3;

    RUNTIME("getTabs");

    // 'getTabs' is not in actionsRepeatBackground, so the index === -1 arm runs
    // and repeats is left untouched on both the message and the counter.
    expect(sent.repeats).toBeUndefined();
    expect(RUNTIME.repeats).toBe(3);
    RUNTIME.repeats = 1;
  });

  it("sends without a callback and marks needResponse false when no callback is given", () => {
    let sent: any;
    let cbArg: unknown = "untouched";
    runtimeStub.sendMessage = vi.fn((msg: unknown, cb?: (r: unknown) => void) => {
      sent = msg;
      cbArg = cb;
    });

    const result = RUNTIME("getTabs");

    expect(Result.isSuccess(result)).toBe(true);
    expect(sent.needResponse).toBe(false);
    expect(cbArg).toBeUndefined();
  });

  it("falls back to 'unknown error' when lastError carries no message", () => {
    runtimeStub.lastError = {} as { message: string };
    runtimeStub.sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => {
      cb?.(undefined);
    });

    RUNTIME("getTabs", null, vi.fn());

    // lastError.message is undefined → the `?? "unknown error"` arm supplies the
    // fallback cause string.
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ cause: "unknown error" }),
    );
  });
});

describe("RUNTIMEAsync", () => {
  it("resolves with the response when no lastError is set", async () => {
    const response = { ok: true };
    runtimeStub.sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => {
      cb?.(response);
    });

    await expect(RUNTIMEAsync("getTabs")).resolves.toEqual(response);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("requests a response from the background", async () => {
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown, cb?: (r: unknown) => void) => {
      sent = msg;
      cb?.(null);
    });

    await RUNTIMEAsync("getTabs");

    // The async variant always consumes the reply, so it must mark needResponse so the
    // background routes a response back.
    expect(sent.needResponse).toBe(true);
  });

  it("rejects on an async lastError and leaves reporting to the caller", async () => {
    runtimeStub.lastError = { message: "Could not establish connection." };
    runtimeStub.sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => {
      cb?.(undefined);
    });

    await expect(RUNTIMEAsync("getTabs")).rejects.toMatchObject({
      kind: "chrome-runtime",
      op: "sendMessage:getTabs",
      cause: "Could not establish connection.",
    });
    // The async variant rejects instead of reporting, so the caller's own .catch reports
    // exactly once rather than double-reporting.
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("rejects when sendMessage throws synchronously", async () => {
    runtimeStub.sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });

    await expect(RUNTIMEAsync("getTabs")).rejects.toMatchObject({
      kind: "chrome-runtime",
      op: "sendMessage:getTabs",
    });
  });
});

describe("dispatchSKEvent", () => {
  it("dispatches the namespaced CustomEvent on document by default", () => {
    const received: CustomEvent[] = [];
    const handler = (e: Event) => received.push(e as CustomEvent);
    document.addEventListener("surfingkeys:front", handler);
    // No target argument → the default `document` parameter is used.
    dispatchSKEvent("front", ["x", 1]);
    document.removeEventListener("surfingkeys:front", handler);

    expect(received).toHaveLength(1);
    expect(received[0]!.detail).toEqual(["x", 1]);
  });

  it("dispatches on an explicit target when one is provided", () => {
    const el = document.createElement("div");
    const received: CustomEvent[] = [];
    el.addEventListener("surfingkeys:user", (e) => received.push(e as CustomEvent));
    dispatchSKEvent("user", { a: 1 }, el);

    expect(received).toHaveLength(1);
    expect(received[0]!.detail).toEqual({ a: 1 });
  });
});

describe("runtime.bookMessage / releaseMessage", () => {
  it("books a fresh message name and refuses to overwrite an existing booking", () => {
    runtime.releaseMessage("wave2-probe");
    expect(runtime.bookMessage("wave2-probe", vi.fn())).toBe(true);
    // Second booking of the same name hits the `if (_handlers[message])` arm.
    expect(runtime.bookMessage("wave2-probe", vi.fn())).toBe(false);
    runtime.releaseMessage("wave2-probe");
    // After release the name is free to book again.
    expect(runtime.bookMessage("wave2-probe", vi.fn())).toBe(true);
    runtime.releaseMessage("wave2-probe");
  });
});

describe("runtime.postTopMessage", () => {
  it("posts the message to the top window using the top origin", async () => {
    const postSpy = vi.spyOn(window.top!, "postMessage").mockImplementation(() => {});
    runtime.postTopMessage({ subject: "wave2" });
    // getTopURLPromise resolves on a microtask; in jsdom window === top, so the
    // origin is window.location.origin and the URL is a normal https one (the
    // `=== "null" || file://` arm stays false).
    await new Promise((r) => setTimeout(r, 0));

    expect(postSpy).toHaveBeenCalledWith({ subject: "wave2" }, window.location.origin);
    postSpy.mockRestore();
  });
});

describe("runtime.getCaseSensitive", () => {
  afterEach(() => {
    runtime.conf.caseSensitive = false;
    runtime.conf.smartCase = false;
  });

  it("is true whenever caseSensitive is set, regardless of the query", () => {
    runtime.conf.caseSensitive = true;
    runtime.conf.smartCase = false;
    expect(runtime.getCaseSensitive("all lower")).toBe(true);
  });

  it("is true under smartCase only when the query contains an uppercase letter", () => {
    runtime.conf.caseSensitive = false;
    runtime.conf.smartCase = true;
    expect(runtime.getCaseSensitive("Hello")).toBe(true);
  });

  it("is false under smartCase when the query is all lowercase", () => {
    runtime.conf.caseSensitive = false;
    runtime.conf.smartCase = true;
    expect(runtime.getCaseSensitive("hello")).toBe(false);
  });

  it("is false when neither caseSensitive nor smartCase is set", () => {
    runtime.conf.caseSensitive = false;
    runtime.conf.smartCase = false;
    expect(runtime.getCaseSensitive("Hello")).toBe(false);
  });
});
