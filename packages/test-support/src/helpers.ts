import { expect, vi } from "vitest";

/** Runtime-checks `value` via `expect` and narrows it to NonNullable for the type checker. */
export function expectDefined<T>(value: T): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
}

/**
 * Let pending microtasks and zero-delay timers run.
 *
 * Anything decided behind an asynchronous read (the logger's level gate, for one) has not reached
 * its destination when the call that started it returns, so assertions have to wait for it.
 *
 * @returns A promise settling once the queued continuations have run.
 */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Stored result a storage read answers with; `undefined` stands for a read that yielded nothing. */
type StoredItems = Record<string, unknown> | undefined;

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
 * Both call forms are served: MV3 code awaits the returned promise, while older call sites pass a
 * callback, and a stub that answers only one of them silently starves the other.
 *
 * @param items - Stored result every read resolves to.
 * @returns A spy usable wherever a `get` implementation is expected.
 */
export function storageGetStub(items: StoredItems) {
  return vi.fn((_keys?: unknown, callback?: (items: StoredItems) => void) => {
    callback?.(items);
    return Promise.resolve(items);
  });
}

/**
 * Install {@link storageGetStub} on the global `chrome` for the duration of a test.
 *
 * @param items - Stored result every read resolves to.
 * @returns A restore function putting the previous implementation back.
 */
export function stubStorageGet(items: StoredItems): () => void {
  // Reflect.get rather than a property access: this package carries no WebExtension type
  // definitions, so `chrome` is not a declared member of globalThis here.
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
