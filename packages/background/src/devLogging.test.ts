import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enableDevLogging, handleRelayedLog } from "./devLogging";

type StorageGet = (keys: string[], cb: (items: any) => void) => void;
const g = globalThis as unknown as { chrome: { storage: { local: { get: StorageGet } } } };
const defaultGet = g.chrome.storage.local.get;
const realFetch = globalThis.fetch;

// The level gate is decided behind an asynchronous storage read, so assertions must let pending
// continuations run before inspecting what was posted.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  g.chrome.storage.local.get = vi.fn((_keys: string[], cb: (items: any) => void) =>
    cb({ logLevels: ["log", "warn", "error"] }),
  );
  fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
  globalThis.fetch = fetchMock;
  // The console sink stays attached alongside the OTLP sink; silence it to keep the output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  g.chrome.storage.local.get = defaultGet;
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** The single record of the payload posted to the collector. */
function postedRecord(): any {
  const [, init] = fetchMock.mock.calls[0] ?? [];
  const payload = JSON.parse(String((init as RequestInit | undefined)?.body));
  return payload.resourceLogs[0].scopeLogs[0].logRecords[0];
}

/** The resource attributes of the payload posted to the collector. */
function postedResourceAttributes(): any {
  const [, init] = fetchMock.mock.calls[0] ?? [];
  const payload = JSON.parse(String((init as RequestInit | undefined)?.body));
  return payload.resourceLogs[0].resource.attributes;
}

describe("enableDevLogging", () => {
  it("posts the background's own records to the collector", async () => {
    const dispose = enableDevLogging(new EventTarget());

    const { LOG } = await import("./log");
    LOG("error", "boom");
    await flush();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:4318/v1/logs");
    expect(postedRecord().body.stringValue).toBe("boom");
    expect(postedResourceAttributes()).toContainEqual({
      key: "sk.context",
      value: { stringValue: "background" },
    });
    dispose();
  });

  it("posts an error the worker never caught", async () => {
    const target = new EventTarget();
    const dispose = enableDevLogging(target);

    target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("boom") }));
    await flush();

    expect(postedRecord().body.stringValue).toBe("Uncaught error: boom");
    dispose();
  });

  it("stops posting once the returned disposer has run", async () => {
    const target = new EventTarget();
    const dispose = enableDevLogging(target);

    dispose();
    const { LOG } = await import("./log");
    LOG("error", "boom");
    target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("boom") }));
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleRelayedLog", () => {
  it("posts a relayed record under the context it came from", () => {
    const handled = handleRelayedLog({
      action: "devLog",
      context: "content",
      level: "warn",
      args: ["careful"],
    });

    expect(handled).toBe(true);
    expect(postedRecord().body.stringValue).toBe("careful");
    expect(postedRecord().severityText).toBe("WARN");
    expect(postedResourceAttributes()).toContainEqual({
      key: "sk.context",
      value: { stringValue: "content" },
    });
  });

  it("keeps the exception attributes of an error flattened by the sender", () => {
    handleRelayedLog({
      action: "devLog",
      context: "frontend",
      level: "error",
      args: ["Failed:", { name: "TypeError", message: "boom", stack: "TypeError: boom" }],
    });

    expect(postedRecord().attributes).toContainEqual({
      key: "exception.type",
      value: { stringValue: "TypeError" },
    });
    expect(postedRecord().body.stringValue).toBe("Failed: boom");
  });

  it("ignores a message that is not a relayed log record", () => {
    expect(handleRelayedLog({ action: "getSettings" })).toBe(false);
    expect(handleRelayedLog(undefined)).toBe(false);
    expect(
      handleRelayedLog({ action: "devLog", context: "content", level: "trace", args: [] }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts one request per relayed record", () => {
    handleRelayedLog({ action: "devLog", context: "content", level: "log", args: ["a"] });
    handleRelayedLog({ action: "devLog", context: "content", level: "log", args: ["b"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
