import { Result } from "@praha/byethrow";
import { RUNTIME } from "@sk/messaging/runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

import createCommands from "./command";
import type { OmnibarResult } from "./omnibarResult";

// Intercept background calls so the command handlers can be driven with canned responses
// instead of reaching chrome.runtime. The return must be a real Result for callers that inspect it.
vi.mock("@sk/messaging/runtime", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@sk/messaging/runtime")>();
  return {
    ...orig,
    RUNTIME: vi.fn(() => Result.succeed(undefined)),
  };
});

const mockRUNTIME = vi.mocked(RUNTIME);

type Handler = (args: string[]) => void | boolean;

/**
 * Register the commands against fakes and expose the captured handlers plus the rows that reach the
 * omnibar. The fake omnibar runs each renderer over its items exactly as the real store does, so a
 * renderer that returns something other than an OmnibarResult surfaces here.
 */
function setup() {
  const handlers: Record<string, Handler> = {};
  const listed: OmnibarResult[][] = [];
  const omnibar = {
    listResults<T>(
      items: readonly T[] | null | undefined,
      renderItem: (item: T) => OmnibarResult | null | undefined,
    ): void {
      const rows: OmnibarResult[] = [];
      (items ?? []).forEach((item) => {
        const row = renderItem(item);
        if (row) {
          rows.push(row);
        }
      });
      listed.push(rows);
    },
    listWords: vi.fn(),
  };
  createCommands(
    { feedkeys: vi.fn() },
    (name, _annotation, handler) => {
      handlers[name] = handler;
    },
    omnibar,
  );
  return { handlers, listed };
}

function runCommand(handlers: Record<string, Handler>, name: string): void {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`command not registered: ${name}`);
  }
  handler([]);
}

function onlyBatch(listed: OmnibarResult[][]): OmnibarResult[] {
  expect(listed).toHaveLength(1);
  const rows = listed[0];
  if (!rows) {
    throw new Error("no results batch was listed");
  }
  return rows;
}

beforeEach(() => {
  mockRUNTIME.mockReset();
  mockRUNTIME.mockReturnValue(Result.succeed(undefined));
});

describe("listSession", () => {
  it("renders each session name as an OmnibarResult row", () => {
    mockRUNTIME.mockImplementation((_action, _args, callback) => {
      callback?.({ settings: { sessions: { work: {}, personal: {} } } });
      return Result.succeed(undefined);
    });

    const { handlers, listed } = setup();
    runCommand(handlers, "listSession");

    const rows = onlyBatch(listed);
    expect(rows.map((row) => row.data.text)).toEqual(["work", "personal"]);
    expect(rows[0]?.html).toContain("work");
  });
});

describe("listQueueURLs", () => {
  it("renders each queued URL as an OmnibarResult row", () => {
    mockRUNTIME.mockImplementation((_action, _args, callback) => {
      callback?.({ queueURLs: ["https://a.example", "https://b.example"] });
      return Result.succeed(undefined);
    });

    const { handlers, listed } = setup();
    runCommand(handlers, "listQueueURLs");

    const rows = onlyBatch(listed);
    expect(rows.map((row) => row.data.text)).toEqual(["https://a.example", "https://b.example"]);
    expect(rows[0]?.html).toContain("https://a.example");
  });
});
