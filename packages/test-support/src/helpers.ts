import { expect } from "vitest";

/** Runtime-checks `value` via `expect` and narrows it to NonNullable for the type checker. */
export function expectDefined<T>(value: T): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
}
