import { Result } from "@praha/byethrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportError } from "./report";
import { RUNTIME } from "./runtime";

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
      expect.objectContaining({ kind: "chrome-runtime", op: "sendMessage:getTabs" }),
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
});
