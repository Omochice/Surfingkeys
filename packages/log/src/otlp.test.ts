import { afterEach, describe, expect, it, vi } from "vitest";

import { otlpSink } from "./otlp";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replaces fetch with a spy resolving to a successful response. */
function stubFetch() {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
  globalThis.fetch = fetchMock;
  return fetchMock;
}

/** Reads back the payload of the single POST the sink made. */
function sentPayload(fetchMock: ReturnType<typeof stubFetch>): any {
  const [, init] = fetchMock.mock.calls[0] ?? [];
  return JSON.parse(String((init as RequestInit | undefined)?.body));
}

/** The single log record of the payload the sink sent. */
function sentRecord(fetchMock: ReturnType<typeof stubFetch>): any {
  return sentPayload(fetchMock).resourceLogs[0].scopeLogs[0].logRecords[0];
}

describe("otlpSink", () => {
  it("posts to the collector's logs endpoint as JSON", () => {
    const fetchMock = stubFetch();

    otlpSink({ url: "http://localhost:4318" })("error", "boom");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:4318/v1/logs");
    expect((init as RequestInit | undefined)?.method).toBe("POST");
    expect((init as any)?.headers).toStrictEqual({ "content-type": "application/json" });
  });

  it("names the emitting service and scope", () => {
    const fetchMock = stubFetch();

    otlpSink({ url: "http://localhost:4318" })("error", "boom");

    const resourceLogs = sentPayload(fetchMock).resourceLogs[0];
    expect(resourceLogs.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "surfingkeys" },
    });
    expect(resourceLogs.scopeLogs[0].scope).toStrictEqual({ name: "@sk/log" });
  });

  it("adds every resource attribute the caller supplied", () => {
    const fetchMock = stubFetch();

    otlpSink({
      url: "http://localhost:4318",
      resourceAttributes: { "sk.context": "background" },
    })("error", "boom");

    expect(sentPayload(fetchMock).resourceLogs[0].resource.attributes).toContainEqual({
      key: "sk.context",
      value: { stringValue: "background" },
    });
  });

  it("repeats sk.context on the record so a single record identifies its origin", () => {
    const fetchMock = stubFetch();

    otlpSink({
      url: "http://localhost:4318",
      resourceAttributes: { "sk.context": "content" },
    })("error", "boom");

    expect(sentRecord(fetchMock).attributes).toStrictEqual([
      { key: "sk.context", value: { stringValue: "content" } },
    ]);
  });

  it("omits sk.context when the caller supplied none", () => {
    const fetchMock = stubFetch();

    otlpSink({ url: "http://localhost:4318" })("error", "boom");

    expect(sentRecord(fetchMock).attributes).toStrictEqual([]);
  });

  it.each([
    ["log", 9, "INFO"],
    ["warn", 13, "WARN"],
    ["error", 17, "ERROR"],
  ] as const)("maps the %s level to its OTLP severity", (level, number, text) => {
    const fetchMock = stubFetch();

    otlpSink({ url: "http://localhost:4318" })(level, "message");

    const record = sentRecord(fetchMock);
    expect(record.severityNumber).toBe(number);
    expect(record.severityText).toBe(text);
  });

  it("timestamps the record in nanoseconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_123);
    const fetchMock = stubFetch();

    otlpSink({ url: "http://localhost:4318" })("error", "boom");
    vi.useRealTimers();

    expect(sentRecord(fetchMock).timeUnixNano).toBe("1700000000123000000");
  });

  it("joins the arguments with a space, as the console would render them", () => {
    const fetchMock = stubFetch();

    otlpSink({ url: "http://localhost:4318" })("error", "Failed to save:", "quota exceeded");

    expect(sentRecord(fetchMock).body).toStrictEqual({
      stringValue: "Failed to save: quota exceeded",
    });
  });

  it("renders an Error argument as its message", () => {
    const fetchMock = stubFetch();

    otlpSink({ url: "http://localhost:4318" })("error", "Failed to save:", new Error("boom"));

    expect(sentRecord(fetchMock).body.stringValue).toBe("Failed to save: boom");
  });

  it("attaches the exception attributes of an Error argument", () => {
    const fetchMock = stubFetch();
    const cause = new TypeError("boom");
    cause.stack = "TypeError: boom\n    at somewhere";

    otlpSink({ url: "http://localhost:4318" })("error", cause);

    expect(sentRecord(fetchMock).attributes).toStrictEqual([
      { key: "exception.type", value: { stringValue: "TypeError" } },
      { key: "exception.message", value: { stringValue: "boom" } },
      { key: "exception.stacktrace", value: { stringValue: "TypeError: boom\n    at somewhere" } },
    ]);
  });

  it("recognises an Error from another realm, which instanceof would miss", () => {
    const fetchMock = stubFetch();
    const cause = { name: "RangeError", message: "boom", stack: "RangeError: boom" };

    otlpSink({ url: "http://localhost:4318" })("error", cause);

    expect(sentRecord(fetchMock).body.stringValue).toBe("boom");
    expect(sentRecord(fetchMock).attributes).toContainEqual({
      key: "exception.type",
      value: { stringValue: "RangeError" },
    });
  });

  it("renders a plain object argument as JSON", () => {
    const fetchMock = stubFetch();

    otlpSink({ url: "http://localhost:4318" })("log", "state:", { open: true });

    expect(sentRecord(fetchMock).body.stringValue).toBe('state: {"open":true}');
  });

  it("swallows a rejected request, so a collector that is not running stays invisible", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    globalThis.fetch = fetchMock;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    expect(() => otlpSink({ url: "http://localhost:4318" })("error", "boom")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("swallows a fetch that throws synchronously", () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error("fetch is not available");
    });

    expect(() => otlpSink({ url: "http://localhost:4318" })("error", "boom")).not.toThrow();
  });
});
