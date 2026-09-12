import { describe, expect, it, vi } from "vitest";

import type { LogLevel } from "./index";
import { consoleSink, createLogger } from "./index";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("consoleSink", () => {
  it("writes the message to the console method named after the level", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    consoleSink("warn", "caution");

    expect(warn).toHaveBeenCalledExactlyOnceWith("caution");
    warn.mockRestore();
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
