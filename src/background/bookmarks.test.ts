import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../test/helpers";
import { createBookmarkHandlers } from "./bookmarks";

type AnyChrome = { bookmarks?: any };
const g = globalThis as unknown as { chrome: AnyChrome };

afterEach(() => {
  delete g.chrome.bookmarks;
});

/** Captures the `result` argument the unit hands to the injected responder. */
function lastResult(respond: ReturnType<typeof vi.fn>): any {
  return respond.mock.calls.at(-1)?.[2];
}

describe("createBookmarkHandlers", () => {
  it("getBookmarkFolders flattens the tree into folder paths, skipping leaf URLs", () => {
    g.chrome.bookmarks = {
      getTree: (cb: (tree: any[]) => void) =>
        cb([
          {
            title: "",
            id: "0",
            children: [
              {
                title: "Bar",
                id: "1",
                children: [
                  {
                    title: "Work",
                    id: "2",
                    children: [{ title: "a link", id: "3", url: "https://x" }],
                  },
                  { title: "a site", id: "4", url: "https://y" },
                ],
              },
            ],
          },
        ]),
    };
    const respond = vi.fn();
    const message = { action: "getBookmarkFolders" };
    const getBookmarkFolders = createBookmarkHandlers(respond)["getBookmarkFolders"];
    expectDefined(getBookmarkFolders);
    getBookmarkFolders(message, {}, vi.fn());

    expect(lastResult(respond).folders).toEqual([
      { id: "1", title: "/Bar/" },
      { id: "2", title: "/Bar/Work/" },
    ]);
  });

  it("getBookmarks filters search results by query, case-insensitively by default", () => {
    g.chrome.bookmarks = {
      search: (_query: string, cb: (tree: any[]) => void) =>
        cb([
          { title: "GitHub", url: "https://github.com" },
          { title: "Example", url: "https://example.com" },
        ]),
    };
    const respond = vi.fn();
    const getBookmarks = createBookmarkHandlers(respond)["getBookmarks"];
    expectDefined(getBookmarks);
    getBookmarks({ query: "git", caseSensitive: false }, {}, vi.fn());

    expect(lastResult(respond).bookmarks).toEqual([{ title: "GitHub", url: "https://github.com" }]);
  });

  it("getBookmarks returns the raw tree children when no query is given", () => {
    const children = [{ title: "x", url: "https://x" }];
    g.chrome.bookmarks = {
      getTree: (cb: (tree: any[]) => void) => cb([{ children }]),
    };
    const respond = vi.fn();
    const getBookmarks = createBookmarkHandlers(respond)["getBookmarks"];
    expectDefined(getBookmarks);
    getBookmarks({}, {}, vi.fn());

    expect(lastResult(respond).bookmarks).toBe(children);
  });

  it("createBookmark creates intermediate path folders before the leaf bookmark", () => {
    const created: any[] = [];
    let nextId = 10;
    g.chrome.bookmarks = {
      search: (_q: any, cb: (b: any[]) => void) => cb([]),
      remove: vi.fn(),
      create: (node: any, cb: (ret: any) => void) => {
        created.push(node);
        cb({ id: String(nextId++) });
      },
    };
    const respond = vi.fn();
    const createBookmark = createBookmarkHandlers(respond)["createBookmark"];
    expectDefined(createBookmark);
    createBookmark(
      { page: { url: "https://x", title: "X", folder: "root", path: ["A", "B"] } },
      {},
      vi.fn(),
    );

    // Two folders (A under root, B under the new A) then the leaf bookmark.
    expect(created.map((n) => n.title)).toEqual(["A", "B", "X"]);
    expect(created[1].parentId).toBe("10");
    expect(created[2]).toMatchObject({ title: "X", url: "https://x" });
  });

  it("removeBookmark removes every bookmark matching the sender tab URL", () => {
    const remove = vi.fn();
    g.chrome.bookmarks = {
      search: (_q: any, cb: (b: any[]) => void) => cb([{ id: "7" }, { id: "8" }]),
      remove,
    };
    const removeBookmark = createBookmarkHandlers(vi.fn())["removeBookmark"];
    expectDefined(removeBookmark);
    removeBookmark({}, { tab: { url: "https://x" } }, vi.fn());

    expect(remove.mock.calls.map((c) => c[0])).toEqual(["7", "8"]);
  });
});
