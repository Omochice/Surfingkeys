import { flush, stubStorageGet } from "@sk/test-support/helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enableDevLogging, handleRelayedLog } from "./devLogging";

const realFetch = globalThis.fetch;

let fetchMock: ReturnType<typeof vi.fn>;
let restoreStorage: () => void;

beforeEach(() => {
  restoreStorage = stubStorageGet({ logLevels: ["log", "warn", "error"] });
  fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
  globalThis.fetch = fetchMock;
  // The console sink stays attached alongside the OTLP sink; silence it to keep the output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  restoreStorage();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function postedPayload(): any {
  const [, init] = fetchMock.mock.calls[0] ?? [];
  return JSON.parse(String((init as RequestInit | undefined)?.body));
}

function postedRecord(): any {
  return postedPayload().resourceLogs[0].scopeLogs[0].logRecords[0];
}

function postedResourceAttributes(): any {
  return postedPayload().resourceLogs[0].resource.attributes;
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
    handleRelayedLog({
      action: "devLog",
      context: "content",
      level: "warn",
      args: ["careful"],
    });

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
    handleRelayedLog({ action: "getSettings" });
    handleRelayedLog(undefined);
    handleRelayedLog({ action: "devLog", context: "content", level: "trace", args: [] });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts one request per relayed record", () => {
    handleRelayedLog({ action: "devLog", context: "content", level: "log", args: ["a"] });
    handleRelayedLog({ action: "devLog", context: "content", level: "log", args: ["b"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
