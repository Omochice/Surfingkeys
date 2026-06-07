import type { MessageHandler } from "./start";

/**
 * Bookmark message handlers: folder listing, create/remove, and query. Owns the `bookmarkFolders`
 * cache it rebuilds from the bookmark tree, and depends only on the promise-based
 * `chrome.bookmarks` API. Handlers resolve to their response payload; the dispatcher in `start`
 * settles the sender.
 */
export function createBookmarkHandlers(): Record<string, MessageHandler> {
  let bookmarkFolders: any[] = [];
  function getFolders(tree: any, root: string) {
    let cd = root;
    if (tree.title !== "" && (!Object.hasOwn(tree, "url") || tree.url == null)) {
      cd += "/" + tree.title;
      bookmarkFolders.push({ id: tree.id, title: cd + "/" });
    }
    if (Object.hasOwn(tree, "children")) {
      for (let i = 0; i < tree.children.length; ++i) {
        getFolders(tree.children[i], cd);
      }
    }
  }

  async function createBookmark(page: any) {
    while (page.path.length) {
      const newFolder = await chrome.bookmarks.create({
        parentId: page.folder,
        title: page.path.shift(),
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
    await Promise.all(bookmarks.map((b) => chrome.bookmarks.remove(b.id)));
  }

  function filterBookmarksByQuery(bookmarks: any[], query: string, caseSensitive: boolean) {
    return bookmarks.filter((b) => {
      let title = b.title;
      let url = b.url;
      if (!caseSensitive) {
        title = title.toLowerCase();
        url = url && url.toLowerCase();
        query = query.toLowerCase();
      }
      return title.indexOf(query) !== -1 || (url && url.indexOf(query) !== -1);
    });
  }

  return {
    getBookmarkFolders: async () => {
      const tree = await chrome.bookmarks.getTree();
      bookmarkFolders = [];
      getFolders(tree[0], "");
      return { folders: bookmarkFolders };
    },
    createBookmark: async (message: any) => {
      await removeBookmark(message.page.url);
      const bookmark = await createBookmark(message.page);
      return { bookmark };
    },
    getBookmarks: async (message: any) => {
      if (message.parentId) {
        const tree = await chrome.bookmarks.getSubTree(message.parentId);
        let bookmarks: any[] = tree[0]!.children ?? [];
        if (message.query && message.query.length) {
          bookmarks = filterBookmarksByQuery(bookmarks, message.query, message.caseSensitive);
        }
        return { bookmarks };
      }
      if (message.query && message.query.length) {
        const tree = await chrome.bookmarks.search(message.query);
        return { bookmarks: filterBookmarksByQuery(tree, message.query, message.caseSensitive) };
      }
      const tree = await chrome.bookmarks.getTree();
      return { bookmarks: tree[0]!.children };
    },
    removeBookmark: (_message: any, sender: any) => removeBookmark(sender.tab.url),
    getBookmark: async (_message: any, sender: any) => {
      const bookmarks = await chrome.bookmarks.search({ url: sender.tab.url });
      return { bookmarks };
    },
  };
}
