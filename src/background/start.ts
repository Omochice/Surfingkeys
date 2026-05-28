import { createBookmarkHandlers } from "./bookmarks.js";
import { createHistoryHandlers } from "./history.js";
import { request } from "./request.js";
import { createSettings } from "./settings.js";
import { createTabs } from "./tabs.js";

// Browser-extension globals. The typed BrowserAdapter (task #13) will replace
// these once cross-browser API access is centralized; background is almost
// entirely chrome.* glue, so it is treated as an untyped boundary here.
declare const chrome: any;

/**
 * A background message handler, dispatched by `message.action`. Returning a truthy value sends it
 * as the synchronous response; returning falsy while `message.needResponse` is set defers to an
 * asynchronous `sendResponse`. Extracted background units export a `Record<string, MessageHandler>`
 * map that the composition root registers into the dispatch registry.
 */
export type MessageHandler = (
  message: any,
  sender?: any,
  sendResponse?: (result: any) => void,
) => any;

const Gist = (() => {
  const self: any = {};

  function _initGist(token: string, magic_word: string, onGistReady: (gist: string) => void) {
    request(
      "https://api.github.com/gists",
      (res) => {
        const gists = JSON.parse(res);
        let gist = "";
        gists.forEach((g: any) => {
          if (
            Object.prototype.hasOwnProperty.call(g, "description") &&
            g["description"] === magic_word &&
            Object.prototype.hasOwnProperty.call(g.files, magic_word)
          ) {
            gist = g.id;
          }
        });
        if (gist === "") {
          request(
            "https://api.github.com/gists",
            (res2) => {
              const ng = JSON.parse(res2);
              onGistReady(ng.id);
            },
            {
              Authorization: "token " + token,
            },
            `{ "description": "${magic_word}", "public": false, "files": { "${magic_word}": { "content": "${magic_word}" } } }`,
          );
        } else {
          onGistReady(gist);
        }
      },
      {
        Authorization: "token " + token,
      },
    );
  }

  let _token: string;
  let _gist = "";
  let _comments: any[] = [];
  self.initGist = (token: string, onGistReady?: (gist: string) => void) => {
    if (_token === token && _gist !== "") {
      return _gist;
    } else {
      _token = token;
      _initGist(_token, "cloudboard", (gist) => {
        _gist = gist;
        onGistReady && onGistReady(_gist);
      });
    }
  };

  function _newComment(text: string, cb?: (res: string) => void) {
    request(
      `https://api.github.com/gists/${_gist}/comments`,
      (res) => {
        cb && cb(res);
      },
      {
        Authorization: "token " + _token,
      },
      `{"body": "${encodeURIComponent(text)}"}`,
    );
  }
  function _readComment(cid: string, cb: (resp: any) => void) {
    request(
      `https://api.github.com/gists/${_gist}/comments/${cid}`,
      (res) => {
        const comment = JSON.parse(res);
        cb({ status: 0, content: decodeURIComponent(comment.body) });
      },
      {
        Authorization: "token " + _token,
      },
    );
  }
  function _listComment(cb: (comments: any[]) => void) {
    request(
      `https://api.github.com/gists/${_gist}/comments`,
      (res) => {
        _comments = JSON.parse(res).map((c: any) => {
          return c.id;
        });
        cb(_comments);
      },
      {
        Authorization: "token " + _token,
      },
    );
  }
  function _writeComment(cid: string, clip: string, cb?: (res: string) => void) {
    request(
      `https://api.github.com/gists/${_gist}/comments/${cid}`,
      (res) => {
        cb && cb(res);
      },
      {
        Authorization: "token " + _token,
      },
      `{"body": "${encodeURIComponent(clip)}"}`,
    );
  }
  self.readComment = (nr: number, cb: (resp: any) => void) => {
    if (_gist === "") {
      cb({ status: 1, content: "Please call initGist first!" });
    } else if (nr >= _comments.length) {
      _listComment((cmts) => {
        if (nr < cmts.length) {
          _readComment(cmts[nr], cb);
        } else {
          cb({ status: 1, content: "Register not exists!" });
        }
      });
    } else {
      _readComment(_comments[nr], cb);
    }
  };
  self.editComment = (nr: number, clip: string, cb: (resp: any) => void) => {
    if (_gist === "") {
      cb({ status: 1, content: "Please call initGist first!" });
    } else if (nr >= _comments.length) {
      _listComment((cmts) => {
        if (nr < cmts.length) {
          _writeComment(cmts[nr], clip, cb);
        } else {
          let toCreate = nr - cmts.length + 1;
          const cbAfterCreated = () => {
            toCreate--;
            if (toCreate > 0) {
              _newComment(".", cbAfterCreated);
            } else if (toCreate === 0) {
              _newComment(clip, cb);
            }
          };
          cbAfterCreated();
        }
      });
    } else {
      _writeComment(_comments[nr], clip, cb);
    }
  };

  return self;
})();

function start(browser: any): void {
  const handlers: Record<string, MessageHandler> = {};

  const isMV3 = chrome.runtime.getManifest().manifest_version === 3;

  const conf: Record<string, any> = {
    focusAfterClosed: "right",
    tabsMRUOrder: true,
    newTabPosition: "default",
    showTabIndices: false,
    interceptedErrors: [],
  };

  const pendingPorts: any[] = [];
  function _response(message: any, sendResponse: (result: any) => void, result: any) {
    const idx = pendingPorts.indexOf(message);
    if (idx !== -1) {
      pendingPorts.splice(idx, 1);
    }
    sendResponse(result);
  }
  function handleMessage(_message: any, _sender: any, _sendResponse: any) {
    if (Object.prototype.hasOwnProperty.call(handlers, _message.action)) {
      const result = handlers[_message.action](_message, _sender, _sendResponse);
      if (_message.needResponse) {
        if (result) {
          _sendResponse(result);
          _message.needResponse = false;
        } else {
          pendingPorts.push(_message);
          // An asynchronous response will be sent using sendResponse later.
        }
        return _message.needResponse;
      }
    } else {
      console.log("[unexpected runtime message] " + JSON.stringify(_message));
    }
  }
  chrome.runtime.onMessage.addListener(handleMessage);
  if (isMV3) {
    chrome.runtime.onUserScriptMessage.addListener((m: any, s: any, r: any) => {
      m.fromUserScript = true;
      handleMessage(m, s, r);
    });
    chrome.runtime.onInstalled.addListener(() => {
      chrome.userScripts.configureWorld({
        csp: "script-src 'self' 'unsafe-eval'",
        messaging: true,
      });
    });
  }

  const tabs = createTabs({ _response, conf, browser, handlers });
  Object.assign(handlers, tabs.handlers);

  const settings = createSettings({
    _response,
    conf,
    browser,
    sendTabMessage: tabs.sendTabMessage,
    tabMessages: tabs.tabMessages,
    setScrollPos: tabs.setScrollPos,
    handlers,
    newTabUrl: tabs.newTabUrl,
    quit: _quit,
  });
  Object.assign(handlers, settings.handlers);

  Object.assign(handlers, createBookmarkHandlers(_response));
  Object.assign(handlers, createHistoryHandlers(_response, browser, tabs.filterByTitleOrUrl));

  handlers.setSurfingkeysIcon = (message: any, sender: any, _sendResponse: any) => {
    let icon = "icons/48.png";
    if (message.status === "disabled") {
      icon = "icons/48-x.png";
    } else if (message.status === "lurking") {
      icon = "icons/48-l.png";
    }
    const browserAction = isMV3 ? chrome.action : chrome.browserAction;
    browserAction.setIcon({
      path: icon,
      tabId: sender.tab ? sender.tab.id : undefined,
    });
  };
  handlers.request = (message: any, _sender: any, sendResponse: any) => {
    request(
      message.url,
      (res) => {
        _response(message, sendResponse, {
          text: res,
        });
      },
      message.headers,
      message.data,
      (e) => {
        _response(message, sendResponse, {
          error: e.toString(),
        });
      },
    );
  };
  handlers.requestImage = (message: any, _sender: any, sendResponse: any) => {
    fetch(message.url, {
      method: "GET",
    })
      .then((res) => {
        return res.blob();
      })
      .then((blob) => {
        return createImageBitmap(blob);
      })
      .then((img) => {
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.convertToBlob().then((blob) => {
          const fr = new FileReader();
          fr.onload = (e) => {
            _response(message, sendResponse, {
              text: e.target!.result,
            });
          };
          fr.readAsDataURL(blob);
        });
      })
      .catch(() => {
        _response(message, sendResponse, {
          text: "",
        });
      });
  };
  function _quit() {
    chrome.windows.getAll(
      {
        populate: false,
      },
      (windows: any[]) => {
        windows.forEach((w) => {
          chrome.windows.remove(w.id);
        });
      },
    );
  }
  handlers.quit = (_message: any, _sender: any, _sendResponse: any) => {
    _quit();
  };
  handlers.closeDownloadsShelf = (message: any, _sender: any, _sendResponse: any) => {
    if (message.clearHistory) {
      chrome.downloads.erase({ urlRegex: ".*" });
    } else {
      chrome.downloads.setShelfEnabled(false);
      chrome.downloads.setShelfEnabled(true);
    }
  };
  handlers.getDownloads = (message: any, _sender: any, sendResponse: any) => {
    chrome.downloads.search(message.query, (items: any[]) => {
      _response(message, sendResponse, {
        downloads: items,
      });
    });
  };
  handlers.download = (message: any, _sender: any, _sendResponse: any) => {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: message.saveAs,
    });
  };
  function _removeURL(uid: string, cb: () => void) {
    const type = uid[0];
    uid = uid.substr(1);
    if (type === "B") {
      chrome.bookmarks.remove(uid, cb);
    } else if (type === "H") {
      chrome.history.deleteUrl({ url: uid }, cb);
    } else if (type === "T") {
      const parts = uid.split(":").map((u) => {
        return parseInt(u);
      });
      chrome.windows.update(
        parts[0],
        {
          focused: true,
        },
        () => {
          chrome.tabs.remove(parts[1], cb);
        },
      );
    } else if (type === "M") {
      settings.loadSettings("marks", (data: any) => {
        delete data.marks[uid];
        settings.updateAndPostSettings({ marks: data.marks }, cb);
      });
    }
  }
  handlers.removeURL = (message: any, _sender: any, sendResponse: any) => {
    let removed = 0;
    let totalToRemoved = message.uid.length;
    let uid = message.uid;
    if (typeof message.uid === "string") {
      totalToRemoved = 1;
      uid = [message.uid];
    }
    function _done() {
      removed++;
      if (removed === totalToRemoved) {
        _response(message, sendResponse, {
          response: "Done",
        });
      }
    }
    uid.forEach((u: string) => {
      _removeURL(u, _done);
    });
  };
  handlers.localData = (message: any, _sender: any, sendResponse: any) => {
    if (message.data.constructor === Object) {
      chrome.storage.local.set(message.data, () => {});
      // broadcast the change also, such as lastKeys
      // we would set lastKeys in sync to avoid breaching chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
      settings.broadcastSettings(message.data);
    } else {
      // string or array of string keys
      chrome.storage.local.get(message.data, (data: any) => {
        _response(message, sendResponse, {
          data: data,
        });
      });
    }
  };
  handlers.captureVisibleTab = (message: any, _sender: any, sendResponse: any) => {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl: string) => {
      _response(message, sendResponse, {
        dataUrl: dataUrl,
      });
    });
  };
  handlers.getCaptureSize = (message: any, _sender: any, sendResponse: any) => {
    const img = document.createElement("img");
    img.onload = () => {
      _response(message, sendResponse, {
        width: img.width,
        height: img.height,
      });
    };
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl: string) => {
      img.src = dataUrl;
    });
  };
  handlers.initGist = (message: any, _sender: any, sendResponse: any) => {
    return Gist.initGist(message.token, (gist: string) => {
      _response(message, sendResponse, {
        gist: gist,
      });
    });
  };
  handlers.readComment = (message: any, _sender: any, sendResponse: any) => {
    Gist.readComment(message.index, (resp: any) => {
      _response(message, sendResponse, resp);
    });
  };
  handlers.editComment = (message: any, _sender: any, sendResponse: any) => {
    Gist.editComment(message.index, message.content, (resp: any) => {
      _response(message, sendResponse, { gistResp: resp });
    });
  };

  handlers.openIncognito = (message: any, _sender: any, _sendResponse: any) => {
    chrome.windows.create({ url: message.url, incognito: true });
  };

  handlers.writeClipboard = (message: any, _sender: any, _sendResponse: any) => {
    navigator.clipboard.writeText(message.text);
  };
  handlers.getContainerName = browser._getContainerName(handlers, _response);
  chrome.runtime.setUninstallURL(
    "http://brookhong.github.io/2018/01/30/why-did-you-uninstall-surfingkeys.html",
  );
}

export { start };
