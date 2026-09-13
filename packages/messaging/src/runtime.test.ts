import { Result } from "@praha/byethrow";
import { repeatCount } from "@sk/core/repeatCount";
import { reportError } from "@sk/core/report";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RUNTIME, runtime } from "./runtime";

vi.mock("@sk/core/report", () => ({ reportError: vi.fn() }));

const reportErrorMock = vi.mocked(reportError);

// @types/chrome types lastError as a read-only getter and sendMessage as a
// promise-returning overload set, neither of which the stub below can satisfy,
// so the runtime is reached through a loosened view.
const runtimeStub = chrome.runtime as unknown as {
  lastError: { message: string } | undefined;
  sendMessage: (msg: unknown, cb?: (response: unknown) => void) => void;
};

afterEach(() => {
  // Sibling tests share one chrome stub, so a failing test must not leak lastError.
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

  it("forwards repeats to the background and resets repeatCount.value for a background-repeat action", () => {
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown) => {
      sent = msg;
    });
    repeatCount.value = 5;

    RUNTIME("closeTab");

    expect(sent.repeats).toBe(5);
    expect(repeatCount.value).toBe(1);
  });

  it("does not attach a repeats field for a non-background-repeat action", () => {
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown) => {
      sent = msg;
    });
    repeatCount.value = 3;

    RUNTIME("getTabs");

    expect(sent.repeats).toBeUndefined();
    expect(repeatCount.value).toBe(3);
    repeatCount.value = 1;
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

    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ cause: "unknown error" }),
    );
  });
});

describe("runtime.bookMessage / releaseMessage", () => {
  it("books a fresh message name and refuses to overwrite an existing booking", () => {
    runtime.releaseMessage("wave2-probe");
    expect(runtime.bookMessage("wave2-probe", vi.fn())).toBe(true);
    expect(runtime.bookMessage("wave2-probe", vi.fn())).toBe(false);
    runtime.releaseMessage("wave2-probe");
    expect(runtime.bookMessage("wave2-probe", vi.fn())).toBe(true);
    runtime.releaseMessage("wave2-probe");
  });
});

describe("runtime.postTopMessage", () => {
  it("posts the message to the top window using the top origin", async () => {
    const postSpy = vi.spyOn(window.top!, "postMessage").mockImplementation(() => {});
    runtime.postTopMessage({ subject: "wave2" });
    // The top URL is resolved asynchronously, so the post happens after a turn.
    // In jsdom window === top, which makes the origin window.location.origin.
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
