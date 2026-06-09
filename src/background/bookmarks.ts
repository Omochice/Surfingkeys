import * as v from "valibot";

import type { MessageHandler } from "./start";

// Bookmark request payloads arrive over chrome.runtime messaging (a trust
// boundary), so each is validated before use instead of being trusted as-is.
const bookmarkPageSchema = v.object({
  url: v.string(),
  title: v.string(),
  path: v.array(v.string()),
  folder: v.string(),
});
type BookmarkPage = v.InferOutput<typeof bookmarkPageSchema>;

const createBookmarkSchema = v.object({ page: bookmarkPageSchema });
const getBookmarksSchema = v.object({
  parentId: v.optional(v.string()),
  query: v.optional(v.string()),
  caseSensitive: v.optional(v.boolean()),
});

/**
 * Bookmark message handlers: folder listing, create/remove, and query. Owns the `bookmarkFolders`
 * cache it rebuilds from the bookmark tree, and depends only on the promise-based
 * `chrome.bookmarks` API. Handlers resolve to their response payload; the dispatcher in `start`
 * settles the sender.
 */
export function createBookmarkHandlers(): Record<string, MessageHandler> {
  let bookmarkFolders: { id: string; title: string }[] = [];
  function getFolders(tree: chrome.bookmarks.BookmarkTreeNode, root: string) {
    let cd = root;
    if (tree.title !== "" && (!Object.hasOwn(tree, "url") || tree.url == null)) {
      cd += "/" + tree.title;
      bookmarkFolders.push({ id: tree.id, title: cd + "/" });
    }
    if (tree.children) {
      for (const child of tree.children) {
        getFolders(child, cd);
      }
    }
  }

  async function createBookmark(page: BookmarkPage) {
    while (page.path.length) {
      const newFolder = await chrome.bookmarks.create({
        parentId: page.folder,
        title: page.path.shift()!,
      });
      page.folder = newFolder.id;
    }
    return chrome.bookmarks.create({
      parentId: page.folder,
      title: page.title,
      url: page.url,
    });
  }

  async function removeBookmark(url: string) {
    const bookmarks = await chrome.bookmarks.search({ url });
    // allSettled, not all: a bookmark removed concurrently elsewhere makes its
    // remove reject, and that must not abort the others or a chained create.
    await Promise.allSettled(bookmarks.map((b) => chrome.bookmarks.remove(b.id)));
  }

  function filterBookmarksByQuery(
    bookmarks: chrome.bookmarks.BookmarkTreeNode[],
    query: string,
    caseSensitive: boolean,
  ) {
    return bookmarks.filter((b) => {
      let title = b.title;
      let url = b.url;
      if (!caseSensitive) {
        title = title.toLowerCase();
        url = url && url.toLowerCase();
        query = query.toLowerCase();
      }
      return title.includes(query) || (url != null && url.includes(query));
    });
  }

  return {
    getBookmarkFolders: async () => {
      const tree = await chrome.bookmarks.getTree();
      bookmarkFolders = [];
      getFolders(tree[0]!, "");
      return { folders: bookmarkFolders };
    },
    createBookmark: async (message: unknown) => {
      const { page } = v.parse(createBookmarkSchema, message);
      await removeBookmark(page.url);
      const bookmark = await createBookmark(page);
      return { bookmark };
    },
    getBookmarks: async (message: unknown) => {
      const { parentId, query, caseSensitive } = v.parse(getBookmarksSchema, message);
      if (parentId) {
        const tree = await chrome.bookmarks.getSubTree(parentId);
        let bookmarks = tree[0]!.children ?? [];
        if (query && query.length) {
          bookmarks = filterBookmarksByQuery(bookmarks, query, caseSensitive ?? false);
        }
        return { bookmarks };
      }
      if (query && query.length) {
        const tree = await chrome.bookmarks.search(query);
        return { bookmarks: filterBookmarksByQuery(tree, query, caseSensitive ?? false) };
      }
      const tree = await chrome.bookmarks.getTree();
      return { bookmarks: tree[0]!.children };
    },
    removeBookmark: async (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      const url = sender?.tab?.url;
      if (url) {
        await removeBookmark(url);
      }
    },
    getBookmark: async (_message: unknown, sender?: chrome.runtime.MessageSender) => {
      const url = sender?.tab?.url;
      const bookmarks = url ? await chrome.bookmarks.search({ url }) : [];
      return { bookmarks };
    },
  };
}
