import { describe, expect, it, vi } from "vitest";

import type { LogLevel, LogSink } from "./index";
import { consoleSink, createLogger, storedLevelGate } from "./index";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("consoleSink", () => {
  it("writes the message to the console method named after the level", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    consoleSink("warn", "caution");

    expect(warn).toHaveBeenCalledExactlyOnceWith("caution");
    warn.mockRestore();
  });

  it("passes every argument to the console method, so an Error keeps its stack", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("boom");

    consoleSink("error", "Failed to save:", cause);

    expect(error).toHaveBeenCalledExactlyOnceWith("Failed to save:", cause);
    error.mockRestore();
  });
});

describe("createLogger", () => {
  it("forwards an enabled record to every sink with the level and message", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const log = createLogger({ sinks: [first, second], isEnabled: () => true });

    log("error", "boom");
    await flush();

    expect(first).toHaveBeenCalledExactlyOnceWith("error", "boom");
    expect(second).toHaveBeenCalledExactlyOnceWith("error", "boom");
  });

  it("forwards every argument of a record to the sinks", async () => {
    const sink = vi.fn();
    const log = createLogger({ sinks: [sink], isEnabled: () => true });
    const cause = new Error("boom");

    log("error", "Failed to save:", cause);
    await flush();

    expect(sink).toHaveBeenCalledExactlyOnceWith("error", "Failed to save:", cause);
  });

  it("writes to a sink appended to the caller's array after construction", async () => {
    const sinks: LogSink[] = [];
    const log = createLogger({ sinks, isEnabled: () => true });
    const late = vi.fn();

    sinks.push(late);
    log("error", "boom");
    await flush();

    expect(late).toHaveBeenCalledExactlyOnceWith("error", "boom");
  });

  it("drops a record whose level the gate rejects", async () => {
    const sink = vi.fn();
    const log = createLogger({ sinks: [sink], isEnabled: (level) => level === "error" });

    log("log", "chatter");
    await flush();

    expect(sink).not.toHaveBeenCalled();
  });

  it("awaits an asynchronous gate before writing to the sinks", async () => {
    const sink = vi.fn();
    const log = createLogger({ sinks: [sink], isEnabled: async () => true });

    log("log", "chatter");

    expect(sink).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sink).toHaveBeenCalledWith("log", "chatter"));
  });

  it("consults the gate on every call so a changing decision takes effect", async () => {
    let enabled = false;
    const sink = vi.fn();
    const isEnabled = vi.fn(() => enabled);
    const log = createLogger({ sinks: [sink], isEnabled });

    log("log", "before");
    await flush();
    expect(sink).not.toHaveBeenCalled();

    enabled = true;
    log("log", "after");
    await flush();

    expect(sink).toHaveBeenCalledExactlyOnceWith("log", "after");
    expect(isEnabled).toHaveBeenCalledTimes(2);
  });

  it("drops the record when the gate throws synchronously", async () => {
    const sink = vi.fn();
    const log = createLogger({
      sinks: [sink],
      isEnabled: () => {
        throw new Error("gate unavailable");
      },
    });

    expect(() => log("error", "boom")).not.toThrow();
    await flush();

    expect(sink).not.toHaveBeenCalled();
  });

  it("drops the record when the gate rejects", async () => {
    const sink = vi.fn();
    const log = createLogger({
      sinks: [sink],
      isEnabled: async () => {
        throw new Error("gate unavailable");
      },
    });

    log("error", "boom");
    await flush();

    expect(sink).not.toHaveBeenCalled();
  });

  it("accepts every log level", async () => {
    const sink = vi.fn();
    const log = createLogger({ sinks: [sink], isEnabled: () => true });
    const levels: LogLevel[] = ["log", "warn", "error"];

    for (const level of levels) {
      log(level, level);
    }
    await flush();

    expect(sink.mock.calls).toStrictEqual([
      ["log", "log"],
      ["warn", "warn"],
      ["error", "error"],
    ]);
  });
});

describe("storedLevelGate", () => {
  it("enables exactly the levels listed in the stored array", async () => {
    const gate = storedLevelGate(async () => ["log", "warn"]);

    expect(await gate("log")).toBe(true);
    expect(await gate("warn")).toBe(true);
    expect(await gate("error")).toBe(false);
  });

  it("enables error only when nothing is stored", async () => {
    const gate = storedLevelGate(async () => undefined);

    expect(await gate("error")).toBe(true);
    expect(await gate("log")).toBe(false);
    expect(await gate("warn")).toBe(false);
  });

  it("enables error only when the stored value is not an array", async () => {
    const gate = storedLevelGate(async () => "log");

    expect(await gate("error")).toBe(true);
    expect(await gate("log")).toBe(false);
  });

  it("silences every level when the stored array is empty", async () => {
    const gate = storedLevelGate(async () => []);

    expect(await gate("error")).toBe(false);
  });

  it("reads on every call so a stored change takes effect immediately", async () => {
    let stored: unknown = [];
    const read = vi.fn(() => Promise.resolve(stored));
    const gate = storedLevelGate(read);

    expect(await gate("log")).toBe(false);
    stored = ["log"];
    expect(await gate("log")).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
