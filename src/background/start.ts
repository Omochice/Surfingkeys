import { Result } from "@praha/byethrow";

import { domApiError } from "../common/result";
import { createBookmarkHandlers } from "./bookmarks";
import { createHistoryHandlers } from "./history";
import { request } from "./request";
import { createSettings } from "./settings";
import { createTabs } from "./tabs";

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
    const auth = { Authorization: "token " + token };
    void request("https://api.github.com/gists", auth).then((r) => {
      if (Result.isFailure(r)) {
        // Without this the message handler never calls `_response`, leaving the
        // runtime sender hung forever; signal failure with an empty gist id.
        onGistReady("");
        return;
      }
      const gists = JSON.parse(r.value);
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
        void request(
          "https://api.github.com/gists",
          auth,
          `{ "description": "${magic_word}", "public": false, "files": { "${magic_word}": { "content": "${magic_word}" } } }`,
        ).then((r2) => {
          // Same hang trap as above: resolve with an empty gist id on failure
          // so the runtime sender never waits indefinitely.
          onGistReady(Result.isSuccess(r2) ? JSON.parse(r2.value).id : "");
        });
      } else {
        onGistReady(gist);
      }
    });
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
      return undefined;
    }
  };

  // The Gist comment helpers below must always invoke their callback, even on
  // request failure: their consumers (`self.readComment`/`self.editComment`)
  // feed the callback straight into `_response`, so a dropped callback hangs the
  // runtime sender forever. Each helper forwards the failure through a payload
  // shaped like its success path so the sender still settles.
  function _newComment(text: string, cb?: (res: string) => void) {
    void request(
      `https://api.github.com/gists/${_gist}/comments`,
      { Authorization: "token " + _token },
      `{"body": "${encodeURIComponent(text)}"}`,
    ).then((r) => {
      cb && cb(Result.isSuccess(r) ? r.value : "");
    });
  }
  function _readComment(cid: string, cb: (resp: any) => void) {
    void request(`https://api.github.com/gists/${_gist}/comments/${cid}`, {
      Authorization: "token " + _token,
    }).then((r) => {
      if (Result.isSuccess(r)) {
        const comment = JSON.parse(r.value);
        cb({ status: 0, content: decodeURIComponent(comment.body) });
      } else {
        cb({ status: 1, error: String(r.error.cause) });
      }
    });
  }
  function _listComment(cb: (comments: any[]) => void, onError: (error: string) => void) {
    void request(`https://api.github.com/gists/${_gist}/comments`, {
      Authorization: "token " + _token,
    }).then((r) => {
      if (Result.isSuccess(r)) {
        _comments = JSON.parse(r.value).map((c: any) => c.id);
        cb(_comments);
      } else {
        onError(String(r.error.cause));
      }
    });
  }
  function _writeComment(cid: string, clip: string, cb?: (res: string) => void) {
    void request(
      `https://api.github.com/gists/${_gist}/comments/${cid}`,
      { Authorization: "token " + _token },
      `{"body": "${encodeURIComponent(clip)}"}`,
    ).then((r) => {
      cb && cb(Result.isSuccess(r) ? r.value : "");
    });
  }
  self.readComment = (nr: number, cb: (resp: any) => void) => {
    if (_gist === "") {
      cb({ status: 1, content: "Please call initGist first!" });
    } else if (nr >= _comments.length) {
      _listComment(
        (cmts) => {
          if (nr < cmts.length) {
            _readComment(cmts[nr], cb);
          } else {
            cb({ status: 1, content: "Register not exists!" });
          }
        },
        (error) => cb({ status: 1, error }),
      );
    } else {
      _readComment(_comments[nr], cb);
    }
  };
  self.editComment = (nr: number, clip: string, cb: (resp: any) => void) => {
    if (_gist === "") {
      cb({ status: 1, content: "Please call initGist first!" });
    } else if (nr >= _comments.length) {
      _listComment(
        (cmts) => {
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
        },
        (error) => cb({ status: 1, error }),
      );
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
    const handler = Object.prototype.hasOwnProperty.call(handlers, _message.action)
      ? handlers[_message.action]
      : undefined;
    if (handler) {
      const result = handler(_message, _sender, _sendResponse);
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
    return undefined;
  }
  chrome.runtime.onMessage.addListener(handleMessage);
  if (isMV3) {
    chrome.runtime.onUserScriptMessage.addListener((m: any, s: any, r: any) => {
      m.fromUserScript = true;
      handleMessage(m, s, r);
    });
    chrome.runtime.onInstalled.addListener(() => {
      if (chrome.userScripts?.configureWorld == null) {
        return;
      }
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

  handlers["setSurfingkeysIcon"] = (message: any, sender: any, _sendResponse: any) => {
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
  handlers["request"] = (message: any, _sender: any, sendResponse: any) => {
    void request(message.url, message.headers, message.data).then((r) => {
      if (Result.isSuccess(r)) {
        _response(message, sendResponse, { text: r.value });
      } else {
        _response(message, sendResponse, { error: String(r.error.cause) });
      }
    });
  };
  handlers["requestImage"] = (message: any, _sender: any, sendResponse: any) => {
    void Result.try({
      try: async () => {
        const res = await fetch(message.url, { method: "GET" });
        const img = await createImageBitmap(await res.blob());
        const canvas = new OffscreenCanvas(img.width, img.height);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const outBlob = await canvas.convertToBlob();
        return await new Promise<string | ArrayBuffer | null>((resolve) => {
          const fr = new FileReader();
          fr.onload = (e) => resolve(e.target!.result);
          fr.readAsDataURL(outBlob);
        });
      },
      catch: (cause) => domApiError("requestImage", cause),
    }).then((r) => {
      _response(message, sendResponse, {
        text: Result.isSuccess(r) ? r.value : "",
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
  handlers["quit"] = (_message: any, _sender: any, _sendResponse: any) => {
    _quit();
  };
  handlers["closeDownloadsShelf"] = (message: any, _sender: any, _sendResponse: any) => {
    if (message.clearHistory) {
      chrome.downloads.erase({ urlRegex: ".*" });
    } else {
      chrome.downloads.setShelfEnabled(false);
      chrome.downloads.setShelfEnabled(true);
    }
  };
  handlers["getDownloads"] = (message: any, _sender: any, sendResponse: any) => {
    chrome.downloads.search(message.query, (items: any[]) => {
      _response(message, sendResponse, {
        downloads: items,
      });
    });
  };
  handlers["download"] = (message: any, _sender: any, _sendResponse: any) => {
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
        parts[0]!,
        {
          focused: true,
        },
        () => {
          chrome.tabs.remove(parts[1]!, cb);
        },
      );
    } else if (type === "M") {
      settings.loadSettings("marks", (data: any) => {
        delete data.marks[uid];
        settings.updateAndPostSettings({ marks: data.marks }, cb);
      });
    }
  }
  handlers["removeURL"] = (message: any, _sender: any, sendResponse: any) => {
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
  handlers["localData"] = (message: any, _sender: any, sendResponse: any) => {
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
  handlers["captureVisibleTab"] = (message: any, _sender: any, sendResponse: any) => {
    chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl: string) => {
      _response(message, sendResponse, {
        dataUrl: dataUrl,
      });
    });
  };
  handlers["getCaptureSize"] = (message: any, _sender: any, sendResponse: any) => {
    const img = document.createElement("img");
    img.onload = () => {
      _response(message, sendResponse, {
        width: img.width,
        height: img.height,
      });
    };
    chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl: string) => {
      img.src = dataUrl;
    });
  };
  handlers["initGist"] = (message: any, _sender: any, sendResponse: any) => {
    return Gist.initGist(message.token, (gist: string) => {
      _response(message, sendResponse, {
        gist: gist,
      });
    });
  };
  handlers["readComment"] = (message: any, _sender: any, sendResponse: any) => {
    Gist.readComment(message.index, (resp: any) => {
      _response(message, sendResponse, resp);
    });
  };
  handlers["editComment"] = (message: any, _sender: any, sendResponse: any) => {
    Gist.editComment(message.index, message.content, (resp: any) => {
      _response(message, sendResponse, { gistResp: resp });
    });
  };

  handlers["openIncognito"] = (message: any, _sender: any, _sendResponse: any) => {
    chrome.windows.create({ url: message.url, incognito: true });
  };

  handlers["writeClipboard"] = (message: any, _sender: any, _sendResponse: any) => {
    navigator.clipboard.writeText(message.text);
  };
  handlers["getContainerName"] = browser._getContainerName(handlers, _response);
  chrome.runtime.setUninstallURL(
    "http://brookhong.github.io/2018/01/30/why-did-you-uninstall-surfingkeys.html",
  );
}

export { start };
