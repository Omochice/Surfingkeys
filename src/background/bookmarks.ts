import type { MessageHandler } from "./start.js";

// Browser-extension global; background is an untyped chrome.* boundary (see start.ts).
declare const chrome: any;

/**
 * Sends a (possibly deferred) response for a handled message; injected from the composition root so
 * the unit shares the one pending-port bookkeeping.
 */
type Respond = (message: any, sendResponse: (result: any) => void, result: any) => void;

/**
 * Bookmark message handlers: folder listing, create/remove, and query. Owns the `bookmarkFolders`
 * cache it rebuilds from the bookmark tree, and depends only on `chrome.bookmarks` and the shared
 * deferred-response helper.
 */
export function createBookmarkHandlers(_response: Respond): Record<string, MessageHandler> {
  let bookmarkFolders: any[] = [];
  function getFolders(tree: any, root: string) {
    let cd = root;
    if (
      tree.title !== "" &&
      (!Object.prototype.hasOwnProperty.call(tree, "url") || tree.url === undefined)
    ) {
      cd += "/" + tree.title;
      bookmarkFolders.push({ id: tree.id, title: cd + "/" });
    }
    if (Object.prototype.hasOwnProperty.call(tree, "children")) {
      for (let i = 0; i < tree.children.length; ++i) {
        getFolders(tree.children[i], cd);
      }
    }
  }

  function createBookmark(page: any, onCreated: (ret: any) => void) {
    if (page.path.length) {
      chrome.bookmarks.create(
        {
          parentId: page.folder,
          title: page.path.shift(),
        },
        (newFolder: any) => {
          page.folder = newFolder.id;
          createBookmark(page, onCreated);
        },
      );
    } else {
      chrome.bookmarks.create(
        {
          parentId: page.folder,
          title: page.title,
          url: page.url,
        },
        (ret: any) => {
          onCreated(ret);
        },
      );
    }
  }

  function removeBookmark(url: string, cb?: () => void) {
    chrome.bookmarks.search(
      {
        url: url,
      },
      (bookmarks: any[]) => {
        bookmarks.forEach((b) => {
          chrome.bookmarks.remove(b.id);
        });
        cb && cb();
      },
    );
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
    getBookmarkFolders: (message: any, _sender: any, sendResponse: any) => {
      chrome.bookmarks.getTree((tree: any[]) => {
        bookmarkFolders = [];
        getFolders(tree[0], "");
        _response(message, sendResponse, {
          folders: bookmarkFolders,
        });
      });
    },
    createBookmark: (message: any, _sender: any, sendResponse: any) => {
      removeBookmark(message.page.url, () => {
        createBookmark(message.page, (ret) => {
          _response(message, sendResponse, {
            bookmark: ret,
          });
        });
      });
    },
    getBookmarks: (message: any, _sender: any, sendResponse: any) => {
      if (message.parentId) {
        chrome.bookmarks.getSubTree(message.parentId, (tree: any[]) => {
          let bookmarks = tree[0].children;
          if (message.query && message.query.length) {
            bookmarks = filterBookmarksByQuery(bookmarks, message.query, message.caseSensitive);
          }
          _response(message, sendResponse, {
            bookmarks: bookmarks,
          });
        });
      } else {
        if (message.query && message.query.length) {
          chrome.bookmarks.search(message.query, (tree: any[]) => {
            _response(message, sendResponse, {
              bookmarks: filterBookmarksByQuery(tree, message.query, message.caseSensitive),
            });
          });
        } else {
          chrome.bookmarks.getTree((tree: any[]) => {
            _response(message, sendResponse, {
              bookmarks: tree[0].children,
            });
          });
        }
      }
    },
    removeBookmark: (_message: any, sender: any, _sendResponse: any) => {
      removeBookmark(sender.tab.url);
    },
    getBookmark: (message: any, sender: any, sendResponse: any) => {
      chrome.bookmarks.search(
        {
          url: sender.tab.url,
        },
        (bookmarks: any[]) => {
          _response(message, sendResponse, {
            bookmarks: bookmarks,
          });
        },
      );
    },
  };
}
