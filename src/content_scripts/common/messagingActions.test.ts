import { afterEach, describe, expect, it, vi } from "vitest";

import { tabOpenLink } from "./messagingActions";

// Collect the detail payloads of surfingkeys:front CustomEvents fired while `run` executes.
function captureFrontEvents(run: () => void): unknown[] {
  const details: unknown[] = [];
  const handler = (e: Event) => details.push((e as CustomEvent).detail);
  document.addEventListener("surfingkeys:front", handler);
  run();
  document.removeEventListener("surfingkeys:front", handler);
  return details;
}

describe("tabOpenLink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens each newline-separated URL via RUNTIME openLink when under the limit", () => {
    const sendMessage = vi
      .spyOn(chrome.runtime, "sendMessage")
      .mockImplementation((() => {}) as any);
    tabOpenLink("https://a.com\nhttps://b.com");
    const openLinkUrls = sendMessage.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m.action === "openLink")
      .map((m: any) => m.url);
    expect(openLinkUrls).toEqual(["https://a.com", "https://b.com"]);
  });

  it("accepts an array of URLs directly (Array constructor arm)", () => {
    const sendMessage = vi
      .spyOn(chrome.runtime, "sendMessage")
      .mockImplementation((() => {}) as any);
    tabOpenLink(["https://x.com", "https://y.com"]);
    const openLinkUrls = sendMessage.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m.action === "openLink")
      .map((m: any) => m.url);
    expect(openLinkUrls).toEqual(["https://x.com", "https://y.com"]);
  });

  it("prompts with a showDialog when the URL count exceeds simultaneousness", () => {
    const details = captureFrontEvents(() => {
      // 3 URLs with simultaneousness=2 trips the `urls.length > simultaneousness` arm.
      tabOpenLink("https://a\nhttps://b\nhttps://c", 2);
    });
    const dialog = details.find((d) => Array.isArray(d) && d[0] === "showDialog") as
      | unknown[]
      | undefined;
    expect(dialog).toBeDefined();
    expect(dialog![1]).toContain("3 links");
  });
});
