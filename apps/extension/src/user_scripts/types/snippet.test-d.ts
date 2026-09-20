import { describe, expectTypeOf, test } from "vitest";

describe("a settings snippet", () => {
  test("uses the documented api without importing anything", () => {
    api.mapkey("<Ctrl-y>", "Show me the money", () => {
      api.Front.showPopup("a well-known phrase");
    });
    api.map("gt", "T");
    expectTypeOf(api.Hints.create).returns.toEqualTypeOf<false | Promise<number>>();
  });

  test("assigns a documented setting", () => {
    settings.hintAlign = "left";
    expectTypeOf(settings).toHaveProperty("scrollStepSize");
  });

  test("rejects a value outside the documented set", () => {
    // @ts-expect-error -- "top" is not an alignment
    settings.hintAlign = "top";
  });

  test("rejects a setting the README does not document", () => {
    expectTypeOf(settings).not.toHaveProperty("noSuchSetting");
  });

  test("rejects an api member the user script path lacks", () => {
    expectTypeOf(api).not.toHaveProperty("noSuchFunction");
  });
});
