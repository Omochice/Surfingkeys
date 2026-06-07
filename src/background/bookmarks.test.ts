import { afterEach, describe, expect, it, vi } from "vitest";

import { expectDefined } from "../../test/helpers";
import { createBookmarkHandlers } from "./bookmarks";

type AnyChrome = { bookmarks?: any };
const g = globalThis as unknown as { chrome: AnyChrome };

afterEach(() => {
  delete g.chrome.bookmarks;
});

describe("createBookmarkHandlers", () => {
  it("getBookmarkFolders flattens the tree into folder paths, skipping leaf URLs", async () => {
    g.chrome.bookmarks = {
      getTree: vi.fn().mockResolvedValue([
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
    const getBookmarkFolders = createBookmarkHandlers()["getBookmarkFolders"];
    expectDefined(getBookmarkFolders);
    const result = await getBookmarkFolders({ action: "getBookmarkFolders" }, {}, vi.fn());

    expect(result.folders).toEqual([
      { id: "1", title: "/Bar/" },
      { id: "2", title: "/Bar/Work/" },
    ]);
  });

  it("getBookmarks filters search results by query, case-insensitively by default", async () => {
    g.chrome.bookmarks = {
      search: vi.fn().mockResolvedValue([
        { title: "GitHub", url: "https://github.com" },
        { title: "Example", url: "https://example.com" },
      ]),
    };
    const getBookmarks = createBookmarkHandlers()["getBookmarks"];
    expectDefined(getBookmarks);
    const result = await getBookmarks({ query: "git", caseSensitive: false }, {}, vi.fn());

    expect(result.bookmarks).toEqual([{ title: "GitHub", url: "https://github.com" }]);
  });

  it("getBookmarks returns the raw tree children when no query is given", async () => {
    const children = [{ title: "x", url: "https://x" }];
    g.chrome.bookmarks = {
      getTree: vi.fn().mockResolvedValue([{ children }]),
    };
    const getBookmarks = createBookmarkHandlers()["getBookmarks"];
    expectDefined(getBookmarks);
    const result = await getBookmarks({}, {}, vi.fn());

    expect(result.bookmarks).toBe(children);
  });

  it("createBookmark creates intermediate path folders before the leaf bookmark", async () => {
    const created: any[] = [];
    let nextId = 10;
    g.chrome.bookmarks = {
      search: vi.fn().mockResolvedValue([]),
      remove: vi.fn(),
      create: vi.fn(async (node: any) => {
        created.push(node);
        return { id: String(nextId++) };
      }),
    };
    const createBookmark = createBookmarkHandlers()["createBookmark"];
    expectDefined(createBookmark);
    await createBookmark(
      { page: { url: "https://x", title: "X", folder: "root", path: ["A", "B"] } },
      {},
      vi.fn(),
    );

    // Two folders (A under root, B under the new A) then the leaf bookmark.
    expect(created.map((n) => n.title)).toEqual(["A", "B", "X"]);
    expect(created[1].parentId).toBe("10");
    expect(created[2]).toMatchObject({ title: "X", url: "https://x" });
  });

  it("removeBookmark removes every bookmark matching the sender tab URL", async () => {
    const remove = vi.fn();
    g.chrome.bookmarks = {
      search: vi.fn().mockResolvedValue([{ id: "7" }, { id: "8" }]),
      remove,
    };
    const removeBookmark = createBookmarkHandlers()["removeBookmark"];
    expectDefined(removeBookmark);
    await removeBookmark({}, { tab: { url: "https://x" } }, vi.fn());

    expect(remove.mock.calls.map((c) => c[0])).toEqual(["7", "8"]);
  });

  it("getBookmark returns empty bookmarks without querying when the sender has no tab", async () => {
    const search = vi.fn();
    g.chrome.bookmarks = { search };
    const getBookmark = createBookmarkHandlers()["getBookmark"];
    expectDefined(getBookmark);
    const result = await getBookmark({}, {}, vi.fn());

    expect(result).toEqual({ bookmarks: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it("removeBookmark does nothing when the sender has no tab", async () => {
    const search = vi.fn();
    const remove = vi.fn();
    g.chrome.bookmarks = { search, remove };
    const removeBookmark = createBookmarkHandlers()["removeBookmark"];
    expectDefined(removeBookmark);

    await expect(removeBookmark({}, {}, vi.fn())).resolves.toBeUndefined();
    expect(search).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
