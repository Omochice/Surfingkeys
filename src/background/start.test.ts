import { Result } from "@praha/byethrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../test/helpers";
import { httpError } from "../common/result";
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
});

/**
 * Drives a successful `initGist` so the shared Gist closure holds a non-empty `_gist`, a
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
    _getContainerName: () => () => {},
    _setNewTabUrl: () => "about:newtab",
    loadRawSettings: (_keys: any, cb: any) => cb({}),
    detectTabTitleChange: false,
    getLatestHistoryItem: () => {},
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

  it("getDownloads searches and responds with the found items", () => {
    const items = [{ url: "https://a/1" }];
    const search = vi.fn((_query: any, cb: any) => cb(items));
    const dispatch = bootWith({ downloads: { search } });
    const sendResponse = vi.fn();
    dispatch(
      { action: "getDownloads", query: { state: "in_progress" }, needResponse: true },
      {},
      sendResponse,
    );
    expect(search).toHaveBeenCalledWith({ state: "in_progress" }, expect.any(Function));
    expect(sendResponse).toHaveBeenCalledWith({ downloads: items });
  });

  it("captureVisibleTab responds with the captured data URL", () => {
    const captureVisibleTab = vi.fn((_opts: any, cb: any) => cb("data:image/png;base64,AAA"));
    const dispatch = bootWith({ tabs: { captureVisibleTab } });
    const sendResponse = vi.fn();
    dispatch({ action: "captureVisibleTab", needResponse: true }, {}, sendResponse);
    expect(captureVisibleTab).toHaveBeenCalledWith({ format: "png" }, expect.any(Function));
    expect(sendResponse).toHaveBeenCalledWith({ dataUrl: "data:image/png;base64,AAA" });
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
});
