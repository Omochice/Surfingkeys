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
});
