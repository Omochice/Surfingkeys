import { expect, vi } from "vitest";

/** Runtime-checks `value` via `expect` and narrows it to NonNullable for the type checker. */
export function expectDefined<T>(value: T): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
}

/** Wait one macrotask turn so pending promise chains settle. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The items a storage read resolves to. */
type StoredItems = Record<string, unknown>;

/** The part of the WebExtension namespace a storage stub replaces. */
type StorageGetHost = { storage: { local: { get: unknown } } };

/** Whether the value exposes `storage.local.get`, i.e. is a usable `chrome` stand-in. */
function isStorageGetHost(value: unknown): value is StorageGetHost {
  if (typeof value !== "object" || value == null || !("storage" in value)) return false;
  const { storage } = value;
  if (typeof storage !== "object" || storage == null || !("local" in storage)) return false;
  const { local } = storage;
  return typeof local === "object" && local != null && "get" in local;
}

/**
 * Build a `chrome.storage.local.get` stub answering the given items.
 *
 * Only the promise form is answered: no call site uses the callback form, and a stub that also
 * answered it would keep a call shape alive that the browser would run differently.
 *
 * @param items - Stored result every read resolves to.
 * @returns A spy usable wherever a `get` implementation is expected.
 */
export function storageGetStub(items: StoredItems) {
  return vi.fn((_keys?: unknown) => Promise.resolve(items));
}

/**
 * Install {@link storageGetStub} on the global `chrome` for the duration of a test.
 *
 * @param items - Stored result every read resolves to.
 * @returns A restore function putting the previous implementation back.
 */
export function stubStorageGet(items: StoredItems): () => void {
  // `globalThis.chrome` does not typecheck here: this package has no chrome type definitions.
  const host: unknown = Reflect.get(globalThis, "chrome");
  if (!isStorageGetHost(host)) {
    throw new Error("chrome.storage.local is not stubbed; import @sk/test-support/setup first");
  }
  const previous = host.storage.local.get;
  host.storage.local.get = storageGetStub(items);
  return () => {
    host.storage.local.get = previous;
  };
}
