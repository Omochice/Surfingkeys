import { describe, expect, it } from "vitest";

import { parseCommandLine } from "./commandLine";

describe("parseCommandLine", () => {
  it("splits a simple space-separated command into tokens", () => {
    expect(parseCommandLine("tabopen https://example.com")).toEqual([
      "tabopen",
      "https://example.com",
    ]);
  });

  it("trims leading and trailing spaces before tokenising", () => {
    expect(parseCommandLine("  open foo  ")).toEqual(["open", "foo"]);
  });

  it("treats a double-quoted span as a single token, dropping the quotes", () => {
    expect(parseCommandLine('search "hello world"')).toEqual(["search", "hello world"]);
  });

  it("handles a quoted argument that contains multiple spaces", () => {
    expect(parseCommandLine('cmd "a  b  c"')).toEqual(["cmd", "a  b  c"]);
  });

  it("returns a single-element array for a command with no arguments", () => {
    expect(parseCommandLine("quit")).toEqual(["quit"]);
  });

  it("returns an empty string token for an empty input", () => {
    expect(parseCommandLine("")).toEqual([""]);
  });

  it("handles consecutive spaces between tokens", () => {
    // Two unquoted spaces are two separators, emitting a single empty-string
    // token between "a" and "b".
    expect(parseCommandLine("a  b")).toEqual(["a", "", "b"]);
  });

  it("handles a quote that opens mid-token", () => {
    // 'cmd arg"with space"end' → cmd, argwith spaceend (quotes stripped, content merged)
    expect(parseCommandLine('cmd arg"with space"end')).toEqual(["cmd", "argwith spaceend"]);
  });
});
