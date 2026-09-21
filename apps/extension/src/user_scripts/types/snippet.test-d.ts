import { describe, expectTypeOf, test } from "vitest";

describe("a settings snippet", () => {
  test("uses the documented api without importing anything", () => {
    api.mapkey(
      "<Ctrl-y>",
      () => {
        api.Front.showPopup("a well-known phrase");
      },
      { annotation: "Show me the money" },
    );
    api.map("gt", "T");
    expectTypeOf(api.Hints.create).returns.toEqualTypeOf<false | Promise<number>>();
  });

  test("takes a search alias's optional settings in the options object", () => {
    api.addSearchAlias("d", "https://duckduckgo.com/?q=", {
      prompt: "duckduckgo",
      suggestionUrl: "https://duckduckgo.com/ac/?q=",
      parseSuggestion: (response) => response,
    });
    // @ts-expect-error -- a string is not an options object
    api.addSearchAlias("d", "duckduckgo", "https://duckduckgo.com/?q=");
  });

  test("removes a search alias without a positional placeholder", () => {
    api.removeSearchAlias("d", { onlyThisSiteKey: "o" });
  });

  test("resolves a background request with the requested type", () => {
    expectTypeOf(api.request<{ urls: string[] }>("getTabURLs")).toEqualTypeOf<
      Promise<{ urls: string[] }>
    >();
  });

  test("sends a fire-and-forget notification", () => {
    expectTypeOf(api.notify("closeTab", { id: 1 })).toEqualTypeOf<void>();
    // @ts-expect-error -- null is not a record of arguments
    api.notify("closeTab", null);
    // @ts-expect-error -- notify takes no callback
    api.notify("closeTab", {}, (response: unknown) => response);
  });

  test("has no RUNTIME member", () => {
    // @ts-expect-error -- RUNTIME is not a member of the api object
    api.RUNTIME("closeTab");
  });

  test("assigns a documented setting", () => {
    settings.hintAlign = "left";
    expectTypeOf(settings).toHaveProperty("scrollStepSize");
  });

  test("rejects a value outside the documented set", () => {
    // @ts-expect-error -- "top" is not an alignment
    settings.hintAlign = "top";
  });

  test("rejects a caretViewport that does not hold four numbers", () => {
    settings.caretViewport = [0, 0, window.innerHeight, window.innerWidth];
    // @ts-expect-error -- the right edge is missing
    settings.caretViewport = [0, 0, window.innerHeight];
  });

  test("rejects a setting the README does not document", () => {
    expectTypeOf(settings).not.toHaveProperty("noSuchSetting");
  });

  test("rejects an api member the user script path lacks", () => {
    expectTypeOf(api).not.toHaveProperty("noSuchFunction");
  });
});
