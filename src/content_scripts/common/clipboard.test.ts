import { describe, expect, it } from "vitest";

import createClipboard from "./clipboard.js";

// Smoke test proving DOM/messaging content-script modules are importable and
// testable under jsdom now that the chrome stub is in place (see setup.ts).
describe("createClipboard", () => {
  it("exposes read and write functions", () => {
    const clipboard = createClipboard();
    expect(typeof clipboard.read).toBe("function");
    expect(typeof clipboard.write).toBe("function");
  });
});
