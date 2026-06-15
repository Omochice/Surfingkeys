import { Result } from "@praha/byethrow";
import { httpError } from "@sk/common/result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../test/helpers";
import { start, type MessageHandler } from "./start";

// The Gist closure and every message handler reach the network through the
// request module; mock it so failure branches are reachable without a real
// fetch.
const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));
vi.mock("./request.js", () => ({ request: mockRequest }));

const g = globalThis as unknown as { chrome: any };
const realChrome = g.chrome;

afterEach(() => {
  g.chrome = realChrome;
  mockRequest.mockReset();
});

/**
 * `start` touches many `chrome.*` namespaces at boot (tabs, windows, sessions, userScripts, ...),
 * mostly to register event listeners. A deep proxy returns a noop for every leaf access so the boot
 * path never throws on a missing API, keeping the harness focused on the handler under test rather
 * than a full chrome mock.
 */
function deepNoop(): any {
  const fn = () => deepNoop();
  return new Proxy(fn, {
    get(_t, prop) {
      // Returning a proxy for `then` would make this stub a thenable, so any
      // `await`/`Promise.resolve` touching a chrome.* path would recurse or
      // hang; keep it non-thenable.
      if (prop === "then") return undefined;
      if (prop === "manifest_version") return 2;
      return deepNoop();
    },
    apply() {
      return deepNoop();
    },
  });
}

/**
 * Boots `start` with inert dependencies and returns the registered dispatch function so a test can
 * drive a single handler by `message.action`. `start` registers its dispatcher via
 * `chrome.runtime.onMessage.addListener`, so the harness captures that callback instead of reaching
 * for the private handler map.
 */
function bootDispatch(): MessageHandler {
  return bootWith({});
}

const gistsFail = () => Result.fail(httpError("https://api.github.com/gists", "boom", 500));

describe("start — initGist", () => {
  it("still settles the response when the initial gist request fails", async () => {
    mockRequest.mockResolvedValue(gistsFail());
    const dispatch = bootDispatch();
    const sendResponse = vi.fn();

    dispatch(
      { action: "initGist", token: "tok-init-fail", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ gist: "" });
  });

  it("still settles the response when the gist-creation request fails", async () => {
    // First request lists gists successfully (none match), forcing the inner
    // creation request, which then fails.
    mockRequest.mockResolvedValueOnce(Result.succeed("[]")).mockResolvedValueOnce(gistsFail());
    const dispatch = bootDispatch();
    const sendResponse = vi.fn();

    dispatch(
      { action: "initGist", token: "tok-create-fail", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ gist: "" });
  });

  it("still settles the response when the initial gist list is malformed JSON", async () => {
    mockRequest.mockResolvedValue(Result.succeed("not-json"));
    const dispatch = bootDispatch();
    const sendResponse = vi.fn();

    dispatch(
      { action: "initGist", token: "tok-init-bad-json", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ gist: "" });
  });

  it("still settles the response when the gist-creation response is malformed JSON", async () => {
    mockRequest
      .mockResolvedValueOnce(Result.succeed("[]"))
      .mockResolvedValueOnce(Result.succeed("not-json"));
    const dispatch = bootDispatch();
    const sendResponse = vi.fn();

    dispatch(
      { action: "initGist", token: "tok-create-bad-json", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ gist: "" });
  });

  it("still settles the response when the gist-creation response lacks an id", async () => {
    // Well-formed JSON whose shape does not match the schema (no `id`): valibot
    // rejects it just like a parse failure, so the sender still settles.
    mockRequest
      .mockResolvedValueOnce(Result.succeed("[]"))
      .mockResolvedValueOnce(Result.succeed(JSON.stringify({ url: "https://example" })));
    const dispatch = bootDispatch();
    const sendResponse = vi.fn();

    dispatch(
      { action: "initGist", token: "tok-create-bad-shape", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ gist: "" });
  });
});

/**
 * Drives a successful `initGist` so the shared Gist closure holds a non-empty `cachedGist`, a
 * precondition for the comment handlers to proceed past their "call initGist first" guard. Returns
 * once the gist id is set.
 */
async function primeGist(dispatch: MessageHandler, token: string): Promise<void> {
  // A matching gist already exists, so no creation request is issued.
  mockRequest.mockResolvedValueOnce(
    Result.succeed(
      JSON.stringify([{ description: "cloudboard", files: { cloudboard: {} }, id: "gist-id" }]),
    ),
  );
  const ready = vi.fn();
  dispatch({ action: "initGist", token, needResponse: true }, { tab: { id: 1 } }, ready);
  await vi.waitFor(() => expect(ready).toHaveBeenCalled());
  mockRequest.mockReset();
}

describe("start — readComment", () => {
  it("still settles the response when listing comments fails", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-list-fail");
    mockRequest.mockResolvedValue(gistsFail());
    const sendResponse = vi.fn();

    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ status: 1 });
  });

  it("still settles the response when reading a known comment fails", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-read-fail");
    // List succeeds with one comment, then the per-comment read fails.
    mockRequest
      .mockResolvedValueOnce(Result.succeed(JSON.stringify([{ id: "c1" }])))
      .mockResolvedValueOnce(gistsFail());
    const sendResponse = vi.fn();

    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ status: 1 });
  });

  it("accepts numeric comment ids from the GitHub API when listing comments", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-numeric-id");
    // GitHub returns gist comment ids as integers, so the list schema must
    // accept numbers; otherwise validation fails and readComment hits the
    // "malformed gist comment list response" error instead of using the list.
    // A large index forces the list path regardless of the shared cache, and
    // "Register not exists!" only occurs once the list has validated.
    mockRequest.mockResolvedValue(Result.succeed(JSON.stringify([{ id: 123 }])));
    const sendResponse = vi.fn();

    dispatch(
      { action: "readComment", index: 1000, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 1,
      content: "Register not exists!",
    });
  });

  it("still settles the response when the comment list is malformed JSON", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-list-bad-json");
    mockRequest.mockResolvedValue(Result.succeed("not-json"));
    const sendResponse = vi.fn();

    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ status: 1 });
  });

  it("still settles the response when the comment list entries lack an id", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-list-bad-shape");
    // Well-formed array whose entries miss the consumed `id` field; valibot
    // rejects it so the handler reports failure instead of mapping to undefined.
    mockRequest.mockResolvedValue(Result.succeed(JSON.stringify([{ body: "x" }])));
    const sendResponse = vi.fn();

    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ status: 1 });
  });
});

describe("start — editComment", () => {
  it("still settles the response when listing comments fails", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-edit-list-fail");
    mockRequest.mockResolvedValue(gistsFail());
    const sendResponse = vi.fn();

    dispatch(
      { action: "editComment", index: 0, content: "x", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toHaveProperty("gistResp");
  });

  it("still settles the response when writing a known comment fails", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-edit-write-fail");
    // List succeeds with one comment, then the write to it fails.
    mockRequest
      .mockResolvedValueOnce(Result.succeed(JSON.stringify([{ id: "c1" }])))
      .mockResolvedValueOnce(gistsFail());
    const sendResponse = vi.fn();

    dispatch(
      { action: "editComment", index: 0, content: "x", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toHaveProperty("gistResp");
  });
});

describe("start — requestImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Stubs the OffscreenCanvas pipeline so the handler reaches a `FileReader` whose `readAsDataURL`
   * fires the event named by `settleVia`, exercising the error/abort paths the handler must now
   * reject on instead of hanging.
   */
  function stubImagePipeline(
    settleVia: "onerror" | "onabort",
    readerError: unknown = new DOMException("read failed"),
  ): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ blob: async () => new Blob() })),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1, height: 1 })),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: () => {} };
        }
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
      },
    );
    vi.stubGlobal(
      "FileReader",
      class {
        onload: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        onabort: ((e: any) => void) | null = null;
        error: unknown = readerError;
        readAsDataURL() {
          this[settleVia]?.({ target: this });
        }
      },
    );
  }

  it.each(["onerror", "onabort"] as const)(
    "settles with an empty text when the FileReader fires %s",
    async (settleVia) => {
      stubImagePipeline(settleVia);
      const dispatch = bootDispatch();
      const sendResponse = vi.fn();

      dispatch(
        { action: "requestImage", url: "https://example.com/x.png", needResponse: true },
        { tab: { id: 1 } },
        sendResponse,
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(sendResponse.mock.calls.at(-1)?.[0]).toEqual({ text: "" });
    },
  );

  it("settles with an empty text when the FileReader error is null", async () => {
    stubImagePipeline("onerror", null);
    const dispatch = bootDispatch();
    const sendResponse = vi.fn();

    dispatch(
      { action: "requestImage", url: "https://example.com/x.png", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toEqual({ text: "" });
  });
});

/**
 * Boots `start` with a chrome stub whose listed namespaces are the supplied recording mocks (every
 * other chrome.* access falls back to the deep noop), and returns the captured dispatcher. Lets a
 * test assert the chrome API a message handler delegates to.
 */
function bootWith(namespaces: Record<string, any>): MessageHandler {
  let dispatch: MessageHandler | undefined;
  const base = deepNoop();
  g.chrome = new Proxy(base, {
    get(_t, prop) {
      if (prop === "runtime") {
        return {
          getManifest: () => ({ version: "0.0.0", manifest_version: 2 }),
          onMessage: {
            addListener: (fn: MessageHandler) => (dispatch = fn),
            removeListener: () => {},
          },
          setUninstallURL: () => {},
        };
      }
      if (typeof prop === "string" && prop in namespaces) {
        const ns = namespaces[prop];
        // Fall back to the deep noop for namespace members the test did not
        // stub, so boot-time wiring (e.g. chrome.tabs.onRemoved) still works.
        return new Proxy(ns, {
          get(_n, key) {
            if (typeof key === "string" && key in ns) return ns[key];
            return base[key];
          },
        });
      }
      return base[prop];
    },
  });
  const browser = {
    getContainerName: () => () => {},
    setNewTabUrl: () => "about:newtab",
    loadRawSettings: (_keys: any, cb: any) => cb({}),
    detectTabTitleChange: false,
    getLatestHistoryItem: () => Promise.resolve([]),
  };
  start(browser);
  expectDefined(dispatch);
  return dispatch;
}

describe("start — tab/window/download handlers delegate to chrome", () => {
  it("openIncognito opens an incognito window for the URL", () => {
    const create = vi.fn();
    const dispatch = bootWith({ windows: { create } });
    dispatch({ action: "openIncognito", url: "https://example.com" }, {}, vi.fn());
    expect(create).toHaveBeenCalledWith({ url: "https://example.com", incognito: true });
  });

  it("download forwards url/filename/saveAs to chrome.downloads", () => {
    const download = vi.fn();
    const dispatch = bootWith({ downloads: { download } });
    dispatch(
      { action: "download", url: "https://x/y.zip", filename: "y.zip", saveAs: true },
      {},
      vi.fn(),
    );
    expect(download).toHaveBeenCalledWith({
      url: "https://x/y.zip",
      filename: "y.zip",
      saveAs: true,
    });
  });

  it("closeDownloadsShelf erases history when clearHistory is set", () => {
    const erase = vi.fn();
    const dispatch = bootWith({ downloads: { erase, setShelfEnabled: vi.fn() } });
    dispatch({ action: "closeDownloadsShelf", clearHistory: true }, {}, vi.fn());
    expect(erase).toHaveBeenCalledWith({ urlRegex: ".*" });
  });

  it("closeDownloadsShelf toggles the shelf off then on without clearHistory", () => {
    const setShelfEnabled = vi.fn();
    const dispatch = bootWith({ downloads: { setShelfEnabled, erase: vi.fn() } });
    dispatch({ action: "closeDownloadsShelf" }, {}, vi.fn());
    expect(setShelfEnabled).toHaveBeenNthCalledWith(1, false);
    expect(setShelfEnabled).toHaveBeenNthCalledWith(2, true);
  });

  it("getDownloads searches and responds with the found items", async () => {
    const items = [{ url: "https://a/1" }];
    const search = vi.fn().mockResolvedValue(items);
    const dispatch = bootWith({ downloads: { search } });
    const sendResponse = vi.fn();
    dispatch(
      { action: "getDownloads", query: { state: "in_progress" }, needResponse: true },
      {},
      sendResponse,
    );
    expect(search).toHaveBeenCalledWith({ state: "in_progress" });
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ downloads: items }));
  });

  it("captureVisibleTab responds with the captured data URL", async () => {
    const captureVisibleTab = vi.fn().mockResolvedValue("data:image/png;base64,AAA");
    const dispatch = bootWith({ tabs: { captureVisibleTab } });
    const sendResponse = vi.fn();
    dispatch({ action: "captureVisibleTab", needResponse: true }, {}, sendResponse);
    expect(captureVisibleTab).toHaveBeenCalledWith({ format: "png" });
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ dataUrl: "data:image/png;base64,AAA" }),
    );
  });

  it("getCaptureSize decodes the capture without document in an MV3 service worker", async () => {
    const captureVisibleTab = vi.fn().mockResolvedValue("data:image/png;base64,AAA");
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob()) }));
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 12, height: 34, close: vi.fn() }),
    );
    // try/finally so a failing assertion still restores the stubbed globals and
    // does not leak them into later tests.
    try {
      const dispatch = bootWith({ tabs: { captureVisibleTab } });
      const sendResponse = vi.fn();
      dispatch({ action: "getCaptureSize", needResponse: true }, {}, sendResponse);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ width: 12, height: 34 }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("setSurfingkeysIcon picks the disabled icon and targets the sender tab", () => {
    const setIcon = vi.fn();
    const dispatch = bootWith({ browserAction: { setIcon } });
    dispatch({ action: "setSurfingkeysIcon", status: "disabled" }, { tab: { id: 7 } }, vi.fn());
    expect(setIcon).toHaveBeenCalledWith({ path: "icons/48-x.png", tabId: 7 });
  });

  it("request responds with the fetched body on success", async () => {
    mockRequest.mockResolvedValue(Result.succeed("BODY"));
    const dispatch = bootWith({});
    const sendResponse = vi.fn();
    dispatch({ action: "request", url: "https://x", needResponse: true }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenLastCalledWith({ text: "BODY" });
  });

  it("request responds with an error string on failure", async () => {
    mockRequest.mockResolvedValue(Result.fail(httpError("https://x", "boom", 500)));
    const dispatch = bootWith({});
    const sendResponse = vi.fn();
    dispatch({ action: "request", url: "https://x", needResponse: true }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toHaveProperty("error");
  });

  it("setSurfingkeysIcon picks the lurking icon for lurking status", () => {
    const setIcon = vi.fn();
    const dispatch = bootWith({ browserAction: { setIcon } });
    dispatch({ action: "setSurfingkeysIcon", status: "lurking" }, { tab: { id: 3 } }, vi.fn());
    expect(setIcon).toHaveBeenCalledWith({ path: "icons/48-l.png", tabId: 3 });
  });

  it("setSurfingkeysIcon picks the default icon for enabled status", () => {
    const setIcon = vi.fn();
    const dispatch = bootWith({ browserAction: { setIcon } });
    dispatch({ action: "setSurfingkeysIcon", status: "enabled" }, { tab: { id: 3 } }, vi.fn());
    expect(setIcon).toHaveBeenCalledWith({ path: "icons/48.png", tabId: 3 });
  });

  it("setSurfingkeysIcon passes undefined tabId when sender has no tab", () => {
    const setIcon = vi.fn();
    const dispatch = bootWith({ browserAction: { setIcon } });
    dispatch({ action: "setSurfingkeysIcon", status: "disabled" }, {}, vi.fn());
    expect(setIcon).toHaveBeenCalledWith({ path: "icons/48-x.png", tabId: undefined });
  });
});

// ---------------------------------------------------------------------------
// handleMessage dispatch branches
// ---------------------------------------------------------------------------

describe("start — handleMessage dispatch", () => {
  it("logs a message for an unrecognized action", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const dispatch = bootDispatch();
    dispatch({ action: "unknownAction42" }, {}, vi.fn());
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("unknownAction42"));
    consoleSpy.mockRestore();
  });

  it("sends the result synchronously when needResponse is true and the handler returns a truthy value", () => {
    // getQueueURLs returns a value synchronously, so with needResponse=true it
    // should call sendResponse immediately rather than pushing to pendingPorts.
    const dispatch = bootDispatch();
    const sendResponse = vi.fn();
    dispatch({ action: "getQueueURLs", needResponse: true }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ queueURLs: [] }));
  });

  it("returns undefined when the handler has no needResponse flag", () => {
    const dispatch = bootDispatch();
    const ret = dispatch({ action: "openIncognito", url: "https://x.com" }, {}, vi.fn());
    expect(ret).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// removeURL — string uid vs array uid, and each type prefix
// ---------------------------------------------------------------------------

describe("start — removeURL", () => {
  it("handles a single string uid (wraps it into an array) and responds after removal", async () => {
    const remove = vi.fn();
    const dispatch = bootWith({ bookmarks: { remove } });
    const sendResponse = vi.fn();
    dispatch({ action: "removeURL", uid: "Bbookmark-id-1", needResponse: true }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ response: "Done" }));
    expect(remove).toHaveBeenCalledWith("bookmark-id-1");
  });

  it("handles an array of uids and only responds after all are done", async () => {
    const deleteUrl = vi.fn();
    const dispatch = bootWith({ history: { deleteUrl } });
    const sendResponse = vi.fn();
    dispatch(
      { action: "removeURL", uid: ["Hhttp://a.com", "Hhttp://b.com"], needResponse: true },
      {},
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ response: "Done" }));
    expect(deleteUrl).toHaveBeenCalledWith({ url: "http://a.com" });
    expect(deleteUrl).toHaveBeenCalledWith({ url: "http://b.com" });
    expect(sendResponse).toHaveBeenCalledTimes(1);
  });

  it("focuses the window and removes the tab for type T uid", async () => {
    const windowsUpdate = vi.fn();
    const tabsRemove = vi.fn();
    const dispatch = bootWith({
      windows: { update: windowsUpdate },
      tabs: { remove: tabsRemove },
    });
    const sendResponse = vi.fn();
    dispatch({ action: "removeURL", uid: "T10:42", needResponse: true }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ response: "Done" }));
    expect(windowsUpdate).toHaveBeenCalledWith(10, { focused: true });
    expect(tabsRemove).toHaveBeenCalledWith(42);
  });
});

// ---------------------------------------------------------------------------
// localData — object vs string/array paths
// ---------------------------------------------------------------------------

describe("start — localData", () => {
  it("sets local storage and broadcasts when data is an Object", () => {
    const localSet = vi.fn();
    const dispatch = bootWith({ storage: { local: { set: localSet } } });
    dispatch({ action: "localData", data: { lastKeys: "abc" } }, {}, vi.fn());
    expect(localSet).toHaveBeenCalledWith({ lastKeys: "abc" });
  });

  it("reads from local storage and responds when data is a string key", async () => {
    const localGet = vi.fn().mockResolvedValue({ lastKeys: "xyz" });
    const dispatch = bootWith({ storage: { local: { get: localGet } } });
    const sendResponse = vi.fn();
    dispatch({ action: "localData", data: "lastKeys", needResponse: true }, {}, sendResponse);
    expect(localGet).toHaveBeenCalledWith("lastKeys");
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ data: { lastKeys: "xyz" } }),
    );
  });
});

// ---------------------------------------------------------------------------
// readComment — no gist set (returns early with error message)
// Note: the Gist singleton is shared across all dispatchers within the same
// module import. These tests therefore run before any primeGist call so that
// cachedGist is still "".  They are placed immediately after the initGist describe
// blocks (which prime cachedGist) and before any further primeGist calls.
// Instead we verify the behaviour via the initGist failure path: after a
// failed initGist the cachedGist stays "". We also re-check the first bootDispatch
// call (before any primeGist) via the very first test run in this file.
// The safest observable is: when gist listing fails, readComment/editComment
// still settle. Those are already covered by the "still settles" tests above.
// We cover the cachedGist=="" guard arm separately in the next describe block.
// ---------------------------------------------------------------------------

// Covered by the initGist failure tests above (they boot fresh dispatchers and
// readComment/editComment are not called until after primeGist in those suites).
// The cachedGist=="" guard is an alternative entry; the test below fires it after
// explicitly forcing a failed initGist so the singleton cachedGist remains empty.

describe("start — readComment / editComment when gist initialisation failed", () => {
  it("readComment settles with status 1 when the gist init failed (gist stays empty)", async () => {
    // Force cachedGist to stay "" by having initGist fail
    mockRequest.mockResolvedValue(gistsFail());
    const dispatch = bootDispatch();
    const initDone = vi.fn();
    dispatch({ action: "initGist", token: "tok-fail-read", needResponse: true }, {}, initDone);
    await vi.waitFor(() => expect(initDone).toHaveBeenCalled());
    // cachedGist is still "" → readComment should bail immediately
    mockRequest.mockReset();

    const sendResponse = vi.fn();
    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ status: 1, content: "Please call initGist first!" }),
      ),
    );
    // No network request should have been made for readComment itself
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("editComment settles with status 1 when the gist init failed (gist stays empty)", async () => {
    mockRequest.mockResolvedValue(gistsFail());
    const dispatch = bootDispatch();
    const initDone = vi.fn();
    dispatch({ action: "initGist", token: "tok-fail-edit", needResponse: true }, {}, initDone);
    await vi.waitFor(() => expect(initDone).toHaveBeenCalled());
    mockRequest.mockReset();

    const sendResponse = vi.fn();
    dispatch(
      { action: "editComment", index: 0, content: "hello", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ gistResp: expect.objectContaining({ status: 1 }) }),
      ),
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// editComment — existing comments list: write path (nr < cmts.length)
// ---------------------------------------------------------------------------

describe("start — editComment writes to an existing comment", () => {
  it("writes to the known comment when the index is within the already-listed range", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-edit-existing");

    // List returns one comment; write to it succeeds
    mockRequest
      .mockResolvedValueOnce(Result.succeed(JSON.stringify([{ id: "c1" }])))
      .mockResolvedValueOnce(Result.succeed("ok"));

    const sendResponse = vi.fn();
    dispatch(
      { action: "editComment", index: 0, content: "updated", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toHaveProperty("gistResp");
  });
});

// ---------------------------------------------------------------------------
// editComment — beyond existing comments: creates placeholders then writes
// ---------------------------------------------------------------------------

describe("start — editComment creates placeholder comments when index exceeds list", () => {
  it("creates a placeholder comment then writes to the final slot", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-edit-create");

    // List returns 0 comments; index=1 → toCreate=2 → creates placeholder "." then writes clip
    mockRequest
      .mockResolvedValueOnce(Result.succeed(JSON.stringify([]))) // listComment
      .mockResolvedValueOnce(Result.succeed("")) // newComment(".")
      .mockResolvedValueOnce(Result.succeed("")); // newComment(clip)

    const sendResponse = vi.fn();
    dispatch(
      { action: "editComment", index: 1, content: "final", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    // Third request is the write for the actual content
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// readComment — comment already in cached list (nr < cachedComments.length)
// ---------------------------------------------------------------------------

describe("start — readComment reads from cached comment list", () => {
  it("reads directly from the cached list when the index is within range", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-cached");

    // Populate cachedComments cache by listing first
    mockRequest.mockResolvedValueOnce(Result.succeed(JSON.stringify([{ id: "c1" }, { id: "c2" }])));
    const listResponse = vi.fn();
    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      listResponse,
    );

    // Wait for list to complete; the per-comment read fails here (no more mock) — that is fine
    mockRequest.mockResolvedValueOnce(Result.succeed(JSON.stringify({ body: "hello" })));
    await vi.waitFor(() => expect(listResponse).toHaveBeenCalled());
    mockRequest.mockReset();

    // Now index 1 is within the cached list → reads directly without listing again
    mockRequest.mockResolvedValueOnce(Result.succeed(JSON.stringify({ body: "world" })));
    const sendResponse = vi.fn();
    dispatch(
      { action: "readComment", index: 1, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ status: 0, content: "world" });
    // Only one request was made (no new list request)
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// readComment — comment list has fewer items than nr (register not exists)
// ---------------------------------------------------------------------------

describe("start — readComment when register does not exist", () => {
  it("settles with 'Register not exists!' when index is beyond the full list", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-not-exists");

    // List returns one comment; requesting index 5 (beyond the list)
    mockRequest.mockResolvedValueOnce(Result.succeed(JSON.stringify([{ id: "c1" }])));
    const sendResponse = vi.fn();
    dispatch(
      { action: "readComment", index: 5, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 1,
      content: "Register not exists!",
    });
  });
});

// ---------------------------------------------------------------------------
// initGist — token already set returns cached gist synchronously
// ---------------------------------------------------------------------------

describe("start — initGist returns cached gist when token matches", () => {
  it("returns the gist id directly when called again with the same token", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-cached");

    // Second initGist with the same token: Gist.initGist resolves the cached gist
    // id without a network round-trip, and the dispatcher forwards the {gist}
    // payload asynchronously (keeping the channel open).
    const sendResponse = vi.fn();
    const ret = dispatch(
      { action: "initGist", token: "tok-cached", needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );
    expect(ret).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ gist: "gist-id" }));
    // No new network request should be made
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// readComment — malformed per-comment response (comment == null)
// ---------------------------------------------------------------------------

describe("start — readComment malformed per-comment JSON", () => {
  it("settles with status 1 when the fetched comment body is malformed JSON", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-comment-bad-json");

    // The Gist closure is a module singleton, so its cachedComments cache leaks across
    // bootDispatch() calls. Overwrite it with a known single-entry list first so
    // the malformed-body branch is exercised in isolation regardless of prior
    // tests; the per-comment read fails here (no more mock) which only re-primes
    // the cache and is irrelevant to the assertion below.
    mockRequest
      .mockResolvedValueOnce(Result.succeed(JSON.stringify([{ id: "c1" }]))) // listComment
      .mockResolvedValueOnce(Result.succeed(JSON.stringify({ body: "hello" }))); // readComment
    const prime = vi.fn();
    dispatch({ action: "readComment", index: 0, needResponse: true }, { tab: { id: 1 } }, prime);
    await vi.waitFor(() => expect(prime).toHaveBeenCalled());
    mockRequest.mockReset();

    // index 0 now hits the cached entry; its per-comment body is malformed JSON,
    // so parseGist returns null and readComment settles with status 1.
    mockRequest.mockResolvedValueOnce(Result.succeed("not-json"));
    const sendResponse = vi.fn();
    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ status: 1 });
  });

  it("settles with status 1 when the fetched comment lacks a body", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-comment-bad-shape");

    // Prime the singleton's cachedComments cache with a single known entry (see the
    // malformed-JSON sibling test for why the per-comment read here is ignored).
    mockRequest
      .mockResolvedValueOnce(Result.succeed(JSON.stringify([{ id: "c1" }]))) // listComment
      .mockResolvedValueOnce(Result.succeed(JSON.stringify({ body: "hello" }))); // readComment
    const prime = vi.fn();
    dispatch({ action: "readComment", index: 0, needResponse: true }, { tab: { id: 1 } }, prime);
    await vi.waitFor(() => expect(prime).toHaveBeenCalled());
    mockRequest.mockReset();

    // Well-formed JSON whose shape misses the consumed `body` field; valibot
    // rejects it so readComment settles with status 1.
    mockRequest.mockResolvedValueOnce(Result.succeed(JSON.stringify({ id: "c1" })));
    const sendResponse = vi.fn();
    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ status: 1 });
  });

  it("settles with status 1 when the comment body has malformed percent-encoding", async () => {
    const dispatch = bootDispatch();
    await primeGist(dispatch, "tok-read-comment-bad-uri");

    // Prime the singleton's cachedComments cache with a single known entry (see the
    // malformed-JSON sibling test for why the per-comment read here is ignored).
    mockRequest
      .mockResolvedValueOnce(Result.succeed(JSON.stringify([{ id: "c1" }]))) // listComment
      .mockResolvedValueOnce(Result.succeed(JSON.stringify({ body: "hello" }))); // readComment
    const prime = vi.fn();
    dispatch({ action: "readComment", index: 0, needResponse: true }, { tab: { id: 1 } }, prime);
    await vi.waitFor(() => expect(prime).toHaveBeenCalled());
    mockRequest.mockReset();

    // A lone "%" passes the body schema but is malformed percent-encoding, so
    // decodeURIComponent throws; without a guard the callback never settles and
    // the runtime sender hangs forever.
    mockRequest.mockResolvedValueOnce(Result.succeed(JSON.stringify({ body: "%" })));
    const sendResponse = vi.fn();
    dispatch(
      { action: "readComment", index: 0, needResponse: true },
      { tab: { id: 1 } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls.at(-1)?.[0]).toMatchObject({ status: 1 });
  });
});
