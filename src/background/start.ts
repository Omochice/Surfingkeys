import { Result } from "@praha/byethrow";
import * as v from "valibot";

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

// GitHub gist API responses are external data; each parsed body is validated so
// the fields consumed below carry real types instead of any.
const gistListSchema = v.array(
  v.object({
    id: v.string(),
    description: v.nullable(v.string()),
    files: v.record(v.string(), v.unknown()),
  }),
);
const createdGistSchema = v.object({ id: v.string() });
const gistCommentSchema = v.object({ body: v.string() });
// GitHub returns gist comment ids as integers (unlike the gist id, which is a
// hex string), so accept both and normalize to string for use in request URLs.
const gistCommentListSchema = v.array(v.object({ id: v.union([v.string(), v.number()]) }));

const Gist = (() => {
  const self: any = {};

  // A 200 response with an empty or malformed body still throws in JSON.parse,
  // which would skip the settle that each helper relies on and re-hang the
  // runtime sender. Treat an unparseable body the same as a request failure.
  const parseGist = (text: string): any | undefined => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  async function _initGist(token: string, magic_word: string): Promise<string> {
    const auth = { Authorization: "token " + token };
    const r = await request("https://api.github.com/gists", auth);
    if (Result.isFailure(r)) {
      // Signal failure with an empty gist id so the awaiting handler still
      // settles instead of leaving the runtime sender hung forever.
      return "";
    }
    const gists = v.safeParse(gistListSchema, parseGist(r.value));
    if (!gists.success) {
      return "";
    }
    let gist = "";
    gists.output.forEach((g) => {
      if (g.description === magic_word && Object.hasOwn(g.files, magic_word)) {
        gist = g.id;
      }
    });
    if (gist !== "") {
      return gist;
    }
    const r2 = await request(
      "https://api.github.com/gists",
      auth,
      `{ "description": "${magic_word}", "public": false, "files": { "${magic_word}": { "content": "${magic_word}" } } }`,
    );
    // Same hang trap as above: resolve with an empty gist id on failure
    // (request error or unparseable body) so the sender never waits.
    const created = Result.isSuccess(r2)
      ? v.safeParse(createdGistSchema, parseGist(r2.value))
      : undefined;
    return created?.success ? created.output.id : "";
  }

  let _token: string;
  let _gist = "";
  let _comments: any[] = [];
  self.initGist = async (token: string): Promise<string> => {
    if (_token === token && _gist !== "") {
      return _gist;
    }
    _token = token;
    _gist = await _initGist(_token, "cloudboard");
    return _gist;
  };

  // The Gist comment helpers below always resolve, even on request failure:
  // their consumers (`self.readComment`/`self.editComment`) hand the result
  // straight to the dispatcher, so a rejected promise would hang the runtime
  // sender forever. Each helper forwards the failure through a payload shaped
  // like its success path so the sender still settles.
  async function _newComment(text: string): Promise<string> {
    const r = await request(
      `https://api.github.com/gists/${_gist}/comments`,
      { Authorization: "token " + _token },
      `{"body": "${encodeURIComponent(text)}"}`,
    );
    return Result.isSuccess(r) ? r.value : "";
  }
  async function _readComment(cid: string): Promise<any> {
    const r = await request(`https://api.github.com/gists/${_gist}/comments/${cid}`, {
      Authorization: "token " + _token,
    });
    if (Result.isFailure(r)) {
      return { status: 1, error: String(r.error.cause) };
    }
    const comment = v.safeParse(gistCommentSchema, parseGist(r.value));
    if (!comment.success) {
      return { status: 1, error: "malformed gist comment response" };
    }
    // The body is an external, user-editable gist comment, so a malformed
    // percent-encoding (e.g. a lone "%") makes decodeURIComponent throw. An
    // unhandled throw here would re-hang the runtime sender, so report it like
    // any other malformed response instead.
    let content: string;
    try {
      content = decodeURIComponent(comment.output.body);
    } catch {
      return { status: 1, error: "malformed gist comment response" };
    }
    return { status: 0, content };
  }
  async function _listComment(): Promise<
    { ok: true; comments: any[] } | { ok: false; error: string }
  > {
    const r = await request(`https://api.github.com/gists/${_gist}/comments`, {
      Authorization: "token " + _token,
    });
    if (Result.isFailure(r)) {
      return { ok: false, error: String(r.error.cause) };
    }
    const comments = v.safeParse(gistCommentListSchema, parseGist(r.value));
    if (!comments.success) {
      return { ok: false, error: "malformed gist comment list response" };
    }
    _comments = comments.output.map((c) => String(c.id));
    return { ok: true, comments: _comments };
  }
  async function _writeComment(cid: string, clip: string): Promise<string> {
    const r = await request(
      `https://api.github.com/gists/${_gist}/comments/${cid}`,
      { Authorization: "token " + _token },
      `{"body": "${encodeURIComponent(clip)}"}`,
    );
    return Result.isSuccess(r) ? r.value : "";
  }
  self.readComment = async (nr: number): Promise<any> => {
    if (_gist === "") {
      return { status: 1, content: "Please call initGist first!" };
    }
    if (nr < _comments.length) {
      return _readComment(_comments[nr]);
    }
    const listed = await _listComment();
    if (!listed.ok) {
      return { status: 1, error: listed.error };
    }
    if (nr < listed.comments.length) {
      return _readComment(listed.comments[nr]);
    }
    return { status: 1, content: "Register not exists!" };
  };
  self.editComment = async (nr: number, clip: string): Promise<any> => {
    if (_gist === "") {
      return { status: 1, content: "Please call initGist first!" };
    }
    if (nr < _comments.length) {
      return _writeComment(_comments[nr], clip);
    }
    const listed = await _listComment();
    if (!listed.ok) {
      return { status: 1, error: listed.error };
    }
    if (nr < listed.comments.length) {
      return _writeComment(listed.comments[nr], clip);
    }
    // Pad the comment list with placeholders up to the requested index, then
    // write the clip into the final new comment.
    let toCreate = nr - listed.comments.length + 1;
    while (toCreate > 1) {
      await _newComment(".");
      toCreate--;
    }
    return _newComment(clip);
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
    const handler = Object.hasOwn(handlers, _message.action)
      ? handlers[_message.action]
      : undefined;
    if (!handler) {
      console.log("[unexpected runtime message] " + JSON.stringify(_message));
      return undefined;
    }
    const result = handler(_message, _sender, _sendResponse);
    // A promise-returning handler resolves to the response value itself, so it
    // needs neither the pendingPorts bookkeeping nor the injected responder.
    // Bridge it to sendResponse here and keep the channel open; settle even on
    // rejection so a throwing handler never re-hangs the sender.
    if (result instanceof Promise) {
      if (!_message.needResponse) {
        void result.catch(() => {});
        return undefined;
      }
      void result.then(
        (value) => _sendResponse(value),
        (error) => _sendResponse({ error: String(error) }),
      );
      return true;
    }
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

  const tabs = createTabs({ conf, browser, handlers });
  Object.assign(handlers, tabs.handlers);

  const settings = createSettings({
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

  Object.assign(handlers, createBookmarkHandlers());
  Object.assign(handlers, createHistoryHandlers(browser, tabs.filterByTitleOrUrl));

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
        return await new Promise<string | ArrayBuffer | null>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = (e) => resolve(e.target!.result);
          // `readAsDataURL` reports failures via `onerror`/`onabort`. Without
          // rejecting here the promise (and the awaiting `Result.try`) would
          // stay pending forever, hanging the background response and leaking.
          // `fr.error` is null on abort and may be null on error, so fall back
          // to an Error rather than rejecting with null.
          fr.onerror = () => reject(fr.error ?? new Error("FileReader failed to read blob"));
          fr.onabort = () => reject(fr.error ?? new Error("FileReader read aborted"));
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
    uid = uid.substring(1);
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
      void settings.loadSettings("marks").then((data: any) => {
        delete data.marks[uid];
        void settings.updateAndPostSettings({ marks: data.marks }).then(cb);
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
      void settings.broadcastSettings(message.data);
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
  handlers["initGist"] = async (message: any) => {
    return { gist: await Gist.initGist(message.token) };
  };
  handlers["readComment"] = (message: any) => Gist.readComment(message.index);
  handlers["editComment"] = async (message: any) => {
    return { gistResp: await Gist.editComment(message.index, message.content) };
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
