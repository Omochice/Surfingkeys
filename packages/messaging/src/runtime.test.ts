import { repeatCount } from "@sk/core/repeatCount";
import { reportError } from "@sk/core/report";
import { afterEach, describe, expect, it, vi } from "vitest";

import { notify, request, runtime } from "./runtime";

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

describe("notify", () => {
  it("sends the action and args without a callback and marks needResponse false", () => {
    let sent: any;
    let cbArg: unknown = "untouched";
    runtimeStub.sendMessage = vi.fn((msg: unknown, cb?: (r: unknown) => void) => {
      sent = msg;
      cbArg = cb;
    });

    const returned = notify("getTabs", { queryInfo: { currentWindow: true } });

    expect(returned).toBeUndefined();
    expect(sent).toMatchObject({
      action: "getTabs",
      queryInfo: { currentWindow: true },
      needResponse: false,
    });
    expect(cbArg).toBeUndefined();
  });

  it("forwards repeats to the background and resets repeatCount.value for a background-repeat action", () => {
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown) => {
      sent = msg;
    });
    repeatCount.value = 5;

    notify("closeTab");

    expect(sent.repeats).toBe(5);
    expect(repeatCount.value).toBe(1);
  });

  it("does not attach a repeats field for a non-background-repeat action", () => {
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown) => {
      sent = msg;
    });
    repeatCount.value = 3;

    notify("getTabs");

    expect(sent.repeats).toBeUndefined();
    expect(repeatCount.value).toBe(3);
    repeatCount.value = 1;
  });

  it("warns on the console instead of reporting when sendMessage throws synchronously", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    runtimeStub.sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });

    expect(notify("getTabs")).toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[runtime exception] sendMessage:getTabs: Error: Extension context invalidated.",
    );
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});

describe("request", () => {
  it("resolves with the response and marks the message as needing one", async () => {
    const response = { ok: true };
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown, cb?: (r: unknown) => void) => {
      sent = msg;
      cb?.(response);
    });

    await expect(request("getTabs")).resolves.toBe(response);
    expect(sent.action).toBe("getTabs");
    expect(sent.needResponse).toBe(true);
  });

  it("rejects with a ChromeRuntimeError on an async lastError without reporting it", async () => {
    runtimeStub.lastError = { message: "Could not establish connection." };
    runtimeStub.sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => {
      cb?.(undefined);
    });

    await expect(request("getTabs")).rejects.toMatchObject({
      kind: "chrome-runtime",
      op: "sendMessage:getTabs",
      cause: "Could not establish connection.",
    });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("falls back to 'unknown error' when lastError carries no message", async () => {
    runtimeStub.lastError = {} as { message: string };
    runtimeStub.sendMessage = vi.fn((_msg: unknown, cb?: (r: unknown) => void) => {
      cb?.(undefined);
    });

    await expect(request("getTabs")).rejects.toMatchObject({ cause: "unknown error" });
  });

  it("rejects with a ChromeRuntimeError when sendMessage throws synchronously", async () => {
    runtimeStub.sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });

    await expect(request("getTabs")).rejects.toMatchObject({
      kind: "chrome-runtime",
      op: "sendMessage:getTabs",
    });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("forwards repeats to the background and resets repeatCount.value for a background-repeat action", async () => {
    let sent: any;
    runtimeStub.sendMessage = vi.fn((msg: unknown, cb?: (r: unknown) => void) => {
      sent = msg;
      cb?.(undefined);
    });
    repeatCount.value = 5;

    await request("closeTab");

    expect(sent.repeats).toBe(5);
    expect(repeatCount.value).toBe(1);
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
